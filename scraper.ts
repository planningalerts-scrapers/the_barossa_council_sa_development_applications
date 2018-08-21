// Parses the development applications at the South Australian The Barossa Council web site and
// places them in a database.
//
// Michael Bone
// 17th August 2018

"use strict";

import * as cheerio from "cheerio";
import * as request from "request-promise-native";
import * as sqlite3 from "sqlite3";
import * as moment from "moment";

sqlite3.verbose();

const DevelopmentApplicationsBaseUrl = "https://epayments.barossa.sa.gov.au/ePathway/Production/Web";
const DevelopmentApplicationsDefaultUrl = `${DevelopmentApplicationsBaseUrl}/default.aspx`;
const DevelopmentApplicationsEnquiryListsUrl = `${DevelopmentApplicationsBaseUrl}/GeneralEnquiry/EnquiryLists.aspx?ModuleCode=LAP`;
const DevelopmentApplicationsEnquirySearchUrl = `${DevelopmentApplicationsBaseUrl}/GeneralEnquiry/EnquirySearch.aspx`;
const DevelopmentApplicationsEnquirySummaryViewUrl = `${DevelopmentApplicationsBaseUrl}/GeneralEnquiry/EnquirySummaryView.aspx`;
const CommentUrl = "mailto:barossa@barossa.sa.gov.au";

// Sets up an sqlite database.

async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        let database = new sqlite3.Database("data.sqlite");
        database.serialize(() => {
            database.run("create table if not exists [data] ([council_reference] text primary key, [address] text, [description] text, [info_url] text, [comment_url] text, [date_scraped] text, [date_received] text, [on_notice_from] text, [on_notice_to] text)");
            resolve(database);
        });
    });
}

// Inserts a row in the database if it does not already exist.

async function insertRow(database, developmentApplication) {
    return new Promise((resolve, reject) => {
        let sqlStatement = database.prepare("insert or replace into [data] values (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        sqlStatement.run([
            developmentApplication.applicationNumber,
            developmentApplication.address,
            developmentApplication.description,
            developmentApplication.informationUrl,
            developmentApplication.commentUrl,
            developmentApplication.scrapeDate,
            developmentApplication.receivedDate,
            null,
            null
        ], function(error, row) {
            if (error) {
                console.error(error);
                reject(error);
            } else {
                if (this.changes > 0)
                    console.log(`    Inserted: application \"${developmentApplication.applicationNumber}\" with address \"${developmentApplication.address}\" and description \"${developmentApplication.description}\" into the database.`);
                else
                    console.log(`    Skipped: application \"${developmentApplication.applicationNumber}\" with address \"${developmentApplication.address}\" and description \"${developmentApplication.description}\" because it was already present in the database.`);
                sqlStatement.finalize();  // releases any locks
                resolve(row);
            }
        });
    });
}

// Parses the "js=" token from a page.

function parseToken(body: string): string {
    let $ = cheerio.load(body);
    for (let script of $("script").get()) {
        let text = $(script).text();
        let startIndex = text.indexOf(".aspx?js=");
        if (startIndex >= 0) {
            startIndex += ".aspx?js=".length;
            let endIndex = text.replace(/"/g, "'").indexOf("'", startIndex);
            if (endIndex > startIndex)
                return text.substring(startIndex, endIndex);
        }
    }
    return null;
}

// Retrieves the development application details page and extracts the full address.

async function retrieveFullAddress(fullAddressUrl: string, jar: request.RequestJar) {
    let body = await request({
        url: fullAddressUrl,
        jar: jar,
        method: "POST",
        followAllRedirects: true
    });
    let $ = cheerio.load(body);
    let address = $($("th:contains('Formatted Property Address')").parent().parent().find("td")[4]).text();  // the address is in the fifth column
    return address.replace(/\s\s+/g, " ").trim();
}

// Parses the development applications.

async function main() {
    // Ensure that the database exists.

    let database = await initializeDatabase();

    // Create one cookie jar and use it throughout.
    
    let jar = request.jar();

    // Retrieve the main page.

    console.log(`Retrieving page: ${DevelopmentApplicationsDefaultUrl}`);
    let body = await request({ url: DevelopmentApplicationsDefaultUrl, jar: jar });

    // Obtain the "js=" token from the page and re-submit the page with the token in the query
    // string.  This then indicates that JavaScript is available in the "client" and so all
    // subsequent pages served by the web server will include JavaScript.

    let token = parseToken(body);
    if (token !== null) {
        let tokenUrl = `${DevelopmentApplicationsDefaultUrl}?js=${token}`;
        console.log(`Retrieving page: ${tokenUrl}`);
        await request({ url: tokenUrl, jar: jar });    
    }
    let $ = cheerio.load(body);
    let eventValidation = $("input[name='__EVENTVALIDATION']").val();
    let viewState = $("input[name='__VIEWSTATE']").val();

    // Retrieve the enquiry lists page.
    
    console.log(`Retrieving page: ${DevelopmentApplicationsEnquiryListsUrl}`);
    body = await request({ url: DevelopmentApplicationsEnquiryListsUrl, jar: jar });
    $ = cheerio.load(body);
    eventValidation = $("input[name='__EVENTVALIDATION']").val();
    viewState = $("input[name='__VIEWSTATE']").val();

    // Retrieve the enquiry search page for "Development Applications".

    console.log("Retrieving the \"Development Applications\" search page.");
    body = await request({
        url: DevelopmentApplicationsEnquiryListsUrl,
        jar: jar,
        method: "POST",
        followAllRedirects: true,
        form: {
            __EVENTVALIDATION: eventValidation,
            __VIEWSTATE: viewState,
            __VIEWSTATEENCRYPTED: "",
            "ctl00$MainBodyContent$mContinueButton": "Next",
            "mDataGrid:Column0:Property": "ctl00$MainBodyContent$mDataList$ctl03$mDataGrid$ctl03$ctl00"
        }
    });
    $ = cheerio.load(body);
    eventValidation = $("input[name='__EVENTVALIDATION']").val();
    viewState = $("input[name='__VIEWSTATE']").val();

    // Switch to the "Date Lodged" tab.

    console.log("Switching to the \"Date Lodged\" tab.");
    body = await request({
        url: DevelopmentApplicationsEnquirySearchUrl,
        jar: jar,
        method: "POST",
        followAllRedirects: true,
        form: {
            __EVENTARGUMENT: "1",
            __EVENTTARGET: "ctl00$MainBodyContent$mGeneralEnquirySearchControl$mTabControl$tabControlMenu",
            __EVENTVALIDATION: eventValidation,
            __VIEWSTATE: viewState
        }
    });
    $ = cheerio.load(body);
    eventValidation = $("input[name='__EVENTVALIDATION']").val();
    viewState = $("input[name='__VIEWSTATE']").val();

    // Search for development applications in the last month.

    let dateFrom = moment().subtract(2, "months").format("DD/MM/YYYY");
    let dateTo = moment().format("DD/MM/YYYY");

    console.log(`Searching for applications in the date range ${dateFrom} to ${dateTo}.`);
    body = await request({
        url: DevelopmentApplicationsEnquirySearchUrl,
        jar: jar,
        method: "POST",
        followAllRedirects: true,
        form: {
            __EVENTVALIDATION: eventValidation,
            __VIEWSTATE: viewState,            
            "ctl00$MainBodyContent$mGeneralEnquirySearchControl$mEnquiryListsDropDownList": "54",
            "ctl00$MainBodyContent$mGeneralEnquirySearchControl$mSearchButton": "Search",
            "ctl00$MainBodyContent$mGeneralEnquirySearchControl$mTabControl$ctl09$DateSearchRadioGroup": "mLast30RadioButton",
            "ctl00$MainBodyContent$mGeneralEnquirySearchControl$mTabControl$ctl09$mFromDatePicker$dateTextBox": dateFrom,
            "ctl00$MainBodyContent$mGeneralEnquirySearchControl$mTabControl$ctl09$mToDatePicker$dateTextBox": dateTo
        }
    });
    $ = cheerio.load(body);
    eventValidation = $("input[name='__EVENTVALIDATION']").val();
    viewState = $("input[name='__VIEWSTATE']").val();

    // Prepare to process multiple pages of results.

    let pageNumber = 1;
    let pageCountText = $("#ctl00_MainBodyContent_mPagingControl_pageNumberLabel").text();
    let pageCount = Math.max(1, Number(pageCountText.match(/[0-9]+$/)[0])) || 1;  // "|| 1" ensures that NaN becomes 1

    do {
        // Parse a page of development applications.
        
        console.log(`Parsing page ${pageNumber} of ${pageCount}.`);
        pageNumber++;

        for (let tableRow of $("tr").get()) {
            let tableCells = $(tableRow).children("td").get();
            if (tableCells.length >= 4) {
                let applicationNumber = $(tableCells[0]).text().trim()
                let receivedDate = moment($(tableCells[1]).text().trim(), "D/MM/YYYY", true);  // allows the leading zero of the day to be omitted
                let description = $(tableCells[3]).text().trim();

                if (/[0-9]+.*/.test(applicationNumber) && receivedDate.isValid()) {
                    // Obtain the full address from the details page (because the address on the
                    // results page does not include the suburb, state or post code).  This slows
                    // down the retrieval of information signifcantly, but is necessary in order
                    // to obtain a complete address.

                    let fullAddressUrl = `${DevelopmentApplicationsBaseUrl}/GeneralEnquiry/${$(tableCells[0]).children("a").attr("href")}`;
                    let address = await retrieveFullAddress(fullAddressUrl, jar);

                    if (address !== undefined && address !== "") {
                        await insertRow(database, {
                            applicationNumber: applicationNumber,
                            address: address,
                            description: ((description === "") ? "No description provided" : description),
                            informationUrl: DevelopmentApplicationsDefaultUrl,
                            commentUrl: CommentUrl,
                            scrapeDate: moment().format("YYYY-MM-DD"),
                            receivedDate: receivedDate.isValid() ? receivedDate.format("YYYY-MM-DD") : ""
                        });
                    }
                }
            }
        }

        if (pageNumber > pageCount)
            break;

        // Navigate to the next page of development applications.

        console.log(`Retrieving the next page of applications (page ${pageNumber} of ${pageCount}).`);
        body = await request({
            url: `${DevelopmentApplicationsEnquirySummaryViewUrl}?PageNumber=${pageNumber}`,
            jar: jar,
            method: "POST",
            followAllRedirects: true,
            form: {
                __EVENTARGUMENT: "",
                __EVENTTARGET: `ctl00$MainBodyContent$mPagingControl$pageButton_${pageNumber}`,
                __EVENTVALIDATION: eventValidation,
                __VIEWSTATE: viewState
            }
        });
        $ = cheerio.load(body);
        eventValidation = $("input[name='__EVENTVALIDATION']").val();
        viewState = $("input[name='__VIEWSTATE']").val();
    } while (pageCount === null || pageNumber <= pageCount || pageNumber >= 50)  // enforce a hard limit of 50 pages (as a safety precaution)
}

main().then(() => console.log("Complete.")).catch(error => console.error(error));
