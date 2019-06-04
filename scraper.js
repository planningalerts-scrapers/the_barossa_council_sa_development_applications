// Parses the development applications at the South Australian The Barossa Council web site and
// places them in a database.
//
// Michael Bone
// 17th August 2018
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cheerio = require("cheerio");
const request = require("request-promise-native");
const sqlite3 = require("sqlite3");
const moment = require("moment");
sqlite3.verbose();
const DevelopmentApplicationsBaseUrl = "https://epayments.barossa.sa.gov.au/ePathway/Production/Web";
const DevelopmentApplicationsDefaultUrl = `${DevelopmentApplicationsBaseUrl}/default.aspx`;
const DevelopmentApplicationsEnquiryListsUrl = `${DevelopmentApplicationsBaseUrl}/GeneralEnquiry/EnquiryLists.aspx?ModuleCode=LAP`;
const DevelopmentApplicationsEnquirySearchUrl = `${DevelopmentApplicationsBaseUrl}/GeneralEnquiry/EnquirySearch.aspx`;
const DevelopmentApplicationsEnquirySummaryViewUrl = `${DevelopmentApplicationsBaseUrl}/GeneralEnquiry/EnquirySummaryView.aspx`;
// Sets up an sqlite database.
async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        let database = new sqlite3.Database("data.sqlite");
        database.serialize(() => {
            database.run("create table if not exists [data] ([council_reference] text primary key, [address] text, [description] text, [info_url] text, [date_scraped] text, [date_received] text)");
            resolve(database);
        });
    });
}
// Inserts a row in the database if it does not already exist.
async function insertRow(database, developmentApplication) {
    return new Promise((resolve, reject) => {
        let sqlStatement = database.prepare("insert or replace into [data] values (?, ?, ?, ?, ?, ?)");
        sqlStatement.run([
            developmentApplication.applicationNumber,
            developmentApplication.address,
            developmentApplication.description,
            developmentApplication.informationUrl,
            developmentApplication.scrapeDate,
            developmentApplication.receivedDate
        ], function (error, row) {
            if (error) {
                console.error(error);
                reject(error);
            }
            else {
                console.log(`    Saved: application \"${developmentApplication.applicationNumber}\" with address \"${developmentApplication.address}\" and description \"${developmentApplication.description}\" into the database.`);
                sqlStatement.finalize(); // releases any locks
                resolve(row);
            }
        });
    });
}
// Parses the "js=" token from a page.
function parseToken(body) {
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
async function retrieveFullAddress(fullAddressUrl, jar) {
    let body = await request({
        url: fullAddressUrl,
        jar: jar,
        method: "POST",
        followAllRedirects: true
    });
    let $ = cheerio.load(body);
    let address = $($("th:contains('Formatted Property Address')").parent().parent().find("td")[4]).text(); // the address is in the fifth column
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
    let dateFrom = moment().subtract(1, "months").format("DD/MM/YYYY");
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
    let pageCount = Math.max(1, Number(pageCountText.match(/[0-9]+$/)[0])) || 1; // "|| 1" ensures that NaN becomes 1
    do {
        // Parse a page of development applications.
        console.log(`Parsing page ${pageNumber} of ${pageCount}.`);
        pageNumber++;
        for (let tableRow of $("tr").get()) {
            let tableCells = $(tableRow).children("td").get();
            if (tableCells.length >= 4) {
                let applicationNumber = $(tableCells[0]).text().trim();
                let receivedDate = moment($(tableCells[1]).text().trim(), "D/MM/YYYY", true); // allows the leading zero of the day to be omitted
                let description = $(tableCells[3]).text().trim();
                if (/[0-9]+.*/.test(applicationNumber) && receivedDate.isValid()) {
                    // Obtain the full address from the details page (because the address on the
                    // results page does not include the suburb, state or post code).  This slows
                    // down the retrieval of information significantly, but is necessary in order
                    // to obtain a complete address.
                    let fullAddressUrl = `${DevelopmentApplicationsBaseUrl}/GeneralEnquiry/${$(tableCells[0]).children("a").attr("href")}`;
                    let address = await retrieveFullAddress(fullAddressUrl, jar);
                    if (address !== undefined && address !== "") {
                        await insertRow(database, {
                            applicationNumber: applicationNumber,
                            address: address,
                            description: ((description === "") ? "No description provided" : description),
                            informationUrl: DevelopmentApplicationsDefaultUrl,
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
    } while (pageCount === null || pageNumber <= pageCount || pageNumber >= 50); // enforce a hard limit of 50 pages (as a safety precaution)
}
main().then(() => console.log("Complete.")).catch(error => console.error(error));
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NyYXBlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNjcmFwZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsK0ZBQStGO0FBQy9GLDZCQUE2QjtBQUM3QixFQUFFO0FBQ0YsZUFBZTtBQUNmLG1CQUFtQjtBQUVuQixZQUFZLENBQUM7O0FBRWIsbUNBQW1DO0FBQ25DLGtEQUFrRDtBQUNsRCxtQ0FBbUM7QUFDbkMsaUNBQWlDO0FBRWpDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztBQUVsQixNQUFNLDhCQUE4QixHQUFHLDZEQUE2RCxDQUFDO0FBQ3JHLE1BQU0saUNBQWlDLEdBQUcsR0FBRyw4QkFBOEIsZUFBZSxDQUFDO0FBQzNGLE1BQU0sc0NBQXNDLEdBQUcsR0FBRyw4QkFBOEIsa0RBQWtELENBQUM7QUFDbkksTUFBTSx1Q0FBdUMsR0FBRyxHQUFHLDhCQUE4QixvQ0FBb0MsQ0FBQztBQUN0SCxNQUFNLDRDQUE0QyxHQUFHLEdBQUcsOEJBQThCLHlDQUF5QyxDQUFDO0FBRWhJLDhCQUE4QjtBQUU5QixLQUFLLFVBQVUsa0JBQWtCO0lBQzdCLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDbkMsSUFBSSxRQUFRLEdBQUcsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBQ25ELFFBQVEsQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFO1lBQ3BCLFFBQVEsQ0FBQyxHQUFHLENBQUMsMEtBQTBLLENBQUMsQ0FBQztZQUN6TCxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDdEIsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUM7QUFFRCw4REFBOEQ7QUFFOUQsS0FBSyxVQUFVLFNBQVMsQ0FBQyxRQUFRLEVBQUUsc0JBQXNCO0lBQ3JELE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7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