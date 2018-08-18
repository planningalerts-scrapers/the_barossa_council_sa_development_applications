// Parses the development applications at the South Australian City of Salisbury web site and
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
        let sqlStatement = database.prepare("insert or ignore into [data] values (?, ?, ?, ?, ?, ?, ?, ?, ?)");
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
        ], function (error, row) {
            if (error) {
                console.error(error);
                reject(error);
            }
            else {
                if (this.changes > 0)
                    console.log(`    Inserted: application \"${developmentApplication.applicationNumber}\" with address \"${developmentApplication.address}\" and description \"${developmentApplication.description}\" into the database.`);
                else
                    console.log(`    Skipped: application \"${developmentApplication.applicationNumber}\" with address \"${developmentApplication.address}\" and description \"${developmentApplication.description}\" because it was already present in the database.`);
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
    // Retrieve the enquiry search page for "Development Applications"
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
    // Switch to the date lodged tab.
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
    // Search for development applications in a date range.
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
                let address = $(tableCells[2]).text().trim();
                let description = $(tableCells[3]).text().trim();
                if (/[0-9]+.*/.test(applicationNumber) && receivedDate.isValid() && address !== "") {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NyYXBlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNjcmFwZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsNkZBQTZGO0FBQzdGLDZCQUE2QjtBQUM3QixFQUFFO0FBQ0YsZUFBZTtBQUNmLG1CQUFtQjtBQUVuQixZQUFZLENBQUM7O0FBRWIsbUNBQW1DO0FBQ25DLGtEQUFrRDtBQUNsRCxtQ0FBbUM7QUFDbkMsaUNBQWlDO0FBRWpDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztBQUVsQixNQUFNLDhCQUE4QixHQUFHLDZEQUE2RCxDQUFDO0FBQ3JHLE1BQU0saUNBQWlDLEdBQUcsR0FBRyw4QkFBOEIsZUFBZSxDQUFDO0FBQzNGLE1BQU0sc0NBQXNDLEdBQUcsR0FBRyw4QkFBOEIsa0RBQWtELENBQUM7QUFDbkksTUFBTSx1Q0FBdUMsR0FBRyxHQUFHLDhCQUE4QixvQ0FBb0MsQ0FBQztBQUN0SCxNQUFNLDRDQUE0QyxHQUFHLEdBQUcsOEJBQThCLHlDQUF5QyxDQUFDO0FBQ2hJLE1BQU0sVUFBVSxHQUFHLGtDQUFrQyxDQUFDO0FBRXRELDhCQUE4QjtBQUU5QixLQUFLLFVBQVUsa0JBQWtCO0lBQzdCLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDbkMsSUFBSSxRQUFRLEdBQUcsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBQ25ELFFBQVEsQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFO1lBQ3BCLFFBQVEsQ0FBQyxHQUFHLENBQUMsME9BQTBPLENBQUMsQ0FBQztZQUN6UCxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDdEIsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUM7QUFFRCw4REFBOEQ7QUFFOUQsS0FBSyxVQUFVLFNBQVMsQ0FBQyxRQUFRLEVBQUUsc0JBQXNCO0lBQ3JELE9BQU8sSUFBSSxPQUFPLENB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QixDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUM7d0JBQzdFLGNBQWMsRUFBRSxpQ0FBaUM7d0JBQ2pELFVBQVUsRUFBRSxVQUFVO3dCQUN0QixVQUFVLEVBQUUsTUFBTSxFQUFFLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQzt3QkFDekMsWUFBWSxFQUFFLFlBQVksQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRTtxQkFDaEYsQ0FBQyxDQUFDO2lCQUNOO2FBQ0o7U0FDSjtRQUVELElBQUksVUFBVSxHQUFHLFNBQVM7WUFDdEIsTUFBTTtRQUVWLHlEQUF5RDtRQUV6RCxPQUFPLENBQUMsR0FBRyxDQUFDLGtEQUFrRCxVQUFVLE9BQU8sU0FBUyxJQUFJLENBQUMsQ0FBQztRQUM5RixJQUFJLEdBQUcsTUFBTSxPQUFPLENBQUM7WUFDakIsR0FBRyxFQUFFLEdBQUcsNENBQTRDLGVBQWUsVUFBVSxFQUFFO1lBQy9FLEdBQUcsRUFBRSxHQUFHO1lBQ1IsTUFBTSxFQUFFLE1BQU07WUFDZCxrQkFBa0IsRUFBRSxJQUFJO1lBQ3hCLElBQUksRUFBRTtnQkFDRixlQUFlLEVBQUUsRUFBRTtnQkFDbkIsYUFBYSxFQUFFLG1EQUFtRCxVQUFVLEVBQUU7Z0JBQzlFLGlCQUFpQixFQUFFLGVBQWU7Z0JBQ2xDLFdBQVcsRUFBRSxTQUFTO2FBQ3pCO1NBQ0osQ0FBQyxDQUFDO1FBQ0gsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDdkIsZUFBZSxHQUFHLENBQUMsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQzdELFNBQVMsR0FBRyxDQUFDLENBQUMsMkJBQTJCLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQztLQUNwRCxRQUFRLFNBQVMsS0FBSyxJQUFJLElBQUksVUFBVSxJQUFJLFNBQVMsSUFBSSxVQUFVLElBQUksRUFBRSxFQUFDLENBQUUsNERBQTREO0FBQzdJLENBQUM7QUFFRCxJQUFJLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyJ9