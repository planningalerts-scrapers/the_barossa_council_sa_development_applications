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
const CommentUrl = "mailto:barossa@barossa.sa.gov.au";
// Sets up an sqlite database.
async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        let database = new sqlite3.Database("data.sqlite");
        database.serialize(() => {
            database.run("create table if not exists [data] ([council_reference] text primary key, [address] text, [description] text, [info_url] text, [comment_url] text, [date_scraped] text, [date_received] text)");
            resolve(database);
        });
    });
}
// Inserts a row in the database if it does not already exist.
async function insertRow(database, developmentApplication) {
    return new Promise((resolve, reject) => {
        let sqlStatement = database.prepare("insert or ignore into [data] values (?, ?, ?, ?, ?, ?, ?)");
        sqlStatement.run([
            developmentApplication.applicationNumber,
            developmentApplication.address,
            developmentApplication.description,
            developmentApplication.informationUrl,
            developmentApplication.commentUrl,
            developmentApplication.scrapeDate,
            developmentApplication.receivedDate
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
    } while (pageCount === null || pageNumber <= pageCount || pageNumber >= 50); // enforce a hard limit of 50 pages (as a safety precaution)
}
main().then(() => console.log("Complete.")).catch(error => console.error(error));
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NyYXBlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNjcmFwZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsK0ZBQStGO0FBQy9GLDZCQUE2QjtBQUM3QixFQUFFO0FBQ0YsZUFBZTtBQUNmLG1CQUFtQjtBQUVuQixZQUFZLENBQUM7O0FBRWIsbUNBQW1DO0FBQ25DLGtEQUFrRDtBQUNsRCxtQ0FBbUM7QUFDbkMsaUNBQWlDO0FBRWpDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztBQUVsQixNQUFNLDhCQUE4QixHQUFHLDZEQUE2RCxDQUFDO0FBQ3JHLE1BQU0saUNBQWlDLEdBQUcsR0FBRyw4QkFBOEIsZUFBZSxDQUFDO0FBQzNGLE1BQU0sc0NBQXNDLEdBQUcsR0FBRyw4QkFBOEIsa0RBQWtELENBQUM7QUFDbkksTUFBTSx1Q0FBdUMsR0FBRyxHQUFHLDhCQUE4QixvQ0FBb0MsQ0FBQztBQUN0SCxNQUFNLDRDQUE0QyxHQUFHLEdBQUcsOEJBQThCLHlDQUF5QyxDQUFDO0FBQ2hJLE1BQU0sVUFBVSxHQUFHLGtDQUFrQyxDQUFDO0FBRXRELDhCQUE4QjtBQUU5QixLQUFLLFVBQVUsa0JBQWtCO0lBQzdCLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDbkMsSUFBSSxRQUFRLEdBQUcsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBQ25ELFFBQVEsQ0FBQyxTQUFTLENBQUMsR0FBRyxFQUFFO1lBQ3BCLFFBQVEsQ0FBQyxHQUFHLENBQUMsOExBQThMLENBQUMsQ0FBQztZQUM3TSxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDdEIsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUM7QUFFRCw4REFBOEQ7QUFFOUQsS0FBSyxVQUFVLFNBQVMsQ0FBQyxRQUFRLEVBQUUsc0JBQXNCO0lBQ3JELE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDbkMsSUFBSSxZQUFZLEdBQUcsUUFBUSxDQUFDLE9BQU8sQ0FBQywyREFBMkQsQ0FBQyxDQUFDO1FBQ2pHLFlBQVksQ0FBQyxHQUFHLENBQUM7WUFDYixzQkFBc0IsQ0FBQyxpQkFBaUI7WUFDeEMsc0JBQXNCLENBQUMsT0FBTztZQUM5QixzQkFBc0IsQ0FBQyxXQUFXO1lBQ2xDLHNCQUFzQixDQUFDLGNBQWM7WUFDckMsc0JBQXNCLENBQUMsVUFBVTtZQUNqQyxzQkFBc0IsQ0FBQyxVQUFVO1lBQ2pDLHNCQUFzQixDQUFDLFlBQVk7U0FDdEMsRUFBRSxVQUFTLEtBQUssRUFBRSxHQUFHO1lBQ2xCLElBQUksS0FBSyxFQUFFO2dCQUNQLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQ3JCLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQzthQUNqQjtpQkFBTTtnQkFDSCxJQUFJLElBQUksQ0FBQyxPQUFPLEdBQUcsQ0FBQztvQkFDaEIsT0FBTyxDQUFDLEdBQUcsQ0FBQywrQkFBK0Isc0JBQXNCLENBQUMsaUJBQWlCLHFCQUFxQixzQkFBc0IsQ0FBQyxPQUFPLHdCQUF3QixzQkFBc0IsQ0FBQyxXQUFXLHVCQUF1QixDQUFDLENBQUM7O29CQUV6TixPQUFPLENBQUMsR0FBRyxDQUFDLDhCQUE4QixzQkFBc0IsQ0FBQyxpQkFBaUIscUJBQXFCLHNCQUFzQixDQUFDLE9BQU8sd0JBQXdCLHNCQUFzQixDQUFDLFdBQVcsb0RBQW9ELENBQUMsQ0FBQztnQkFDelAsWUFBWSxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUUscUJBQXFCO2dCQUMvQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUM7YUFDaEI7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNQLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQztBQUVELHNDQUFzQztBQUV0QyxTQUFTLFVBQVUsQ0FBQyxJQUFZO0lBQzVCLElBQUksQ0FBQyxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDM0IsS0FBSyxJQUFJLE1BQU0sSUFBSSxDQUFDLENBQUMsUUFBUSxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUU7UUFDbEMsSUFBSSxJQUFJLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO1FBQzVCLElBQUksVUFBVSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUM7UUFDM0MsSUFBSSxVQUFVLElBQUksQ0FBQyxFQUFFO1lBQ2pCLFVBQVUsSUFBSSxXQUFXLENBQUMsTUFBTSxDQUFDO1lBQ2pDLElBQUksUUFBUSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsVUFBVSxDQUFDLENBQUM7WUFDaEUsSUFBSSxRQUFRLEdBQUcsVUFBVTtnQkFDckIsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQztTQUNuRDtLQUNKO0lBQ0QsT0FBTyxJQUFJLENBQUM7QUFDaEIsQ0FBQztBQUVELG9GQUFvRjtBQUVwRixLQUFLLFVBQVUsbUJBQW1CLENBQUMsY0FBc0IsRUFBRSxHQUF1QjtJQUM5RSxJQUFJLElBQUksR0FBRyxNQUFNLE9BQU8sQ0FBQztRQUNyQixHQUFHLEVBQUUsY0FBYztRQUNuQixHQUFHLEVBQUUsR0FBRztRQUNSLE1BQU0sRUFBRSxNQUFNO1FBQ2Qsa0JBQWtCLEVBQUUsSUFBSTtLQUMzQixDQUFDLENBQUM7SUFDSCxJQUFJLENBQUMsR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzNCLElBQUksT0FBTyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsMkNBQTJDLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFFLHFDQUFxQztJQUM5SSxPQUFPLE9BQU8sQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO0FBQ2pELENBQUM7QUFFRCx1Q0FBdUM7QUFFdkMsS0FBSyxVQUFVLElBQUk7SUFDZixtQ0FBbUM7SUFFbkMsSUFBSSxRQUFRLEdBQUcsTUFBTSxrQkFBa0IsRUFBRSxDQUFDO0lBRTFDLCtDQUErQztJQUUvQyxJQUFJLEdBQUcsR0FBRyxPQUFPLENBQUMsR0FBRyxFQUFFLENBQUM7SUFFeEIsMEJBQTBCO0lBRTFCLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQW9CLGlDQUFpQyxFQUFFLENBQUMsQ0FBQztJQUNyRSxJQUFJLElBQUksR0FBRyxNQUFNLE9BQU8sQ0FBQyxFQUFFLEdBQUcsRUFBRSxpQ0FBaUMsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUUvRSwwRkFBMEY7SUFDMUYsdUZBQXVGO0lBQ3ZGLHFFQUFxRTtJQUVyRSxJQUFJLEtBQUssR0FBRyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDN0IsSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFO1FBQ2hCLElBQUksUUFBUSxHQUFHLEdBQUcsaUNBQWlDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDbEUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsUUFBUSxFQUFFLENBQUMsQ0FBQztRQUM1QyxNQUFNLE9BQU8sQ0FBQyxFQUFFLEdBQUcsRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUM7S0FDOUM7SUFDRCxJQUFJLENBQUMsR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzNCLElBQUksZUFBZSxHQUFHLENBQUMsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBQ2pFLElBQUksU0FBUyxHQUFHLENBQUMsQ0FBQywyQkFBMkIsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBRXJELG1DQUFtQztJQUVuQyxPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFvQixzQ0FBc0MsRUFBRSxDQUFDLENBQUM7SUFDMUUsSUFBSSxHQUFHLE1BQU0sT0FBTyxDQUFDLEVBQUUsR0FBRyxFQUFFLHNDQUFzQyxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDO0lBQ2hGLENBQUMsR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3ZCLGVBQWUsR0FBRyxDQUFDLENBQUMsaUNBQWlDLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUM3RCxTQUFTLEdBQUcsQ0FBQyxDQUFDLDJCQUEyQixDQUFDLENBQUMsR0FBRyxFQUFFLENBQUM7SUFFakQsbUVBQW1FO0lBRW5FLE9BQU8sQ0FBQyxHQUFHLENBQUMsMERBQTBELENBQUMsQ0FBQztJQUN4RSxJQUFJLEdBQUcsTUFBTSxPQUFPLENBQUM7UUFDakIsR0FBRyxFQUFFLHNDQUFzQztRQUMzQyxHQUFHLEVBQUUsR0FBRztRQUNSLE1BQU0sRUFBRSxNQUFNO1FBQ2Qsa0JBQWtCLEVBQUUsSUFBSTtRQUN4QixJQUFJLEVBQUU7WUFDRixpQkFBaUIsRUFBRSxlQUFlO1lBQ2xDLFdBQVcsRUFBRSxTQUFTO1lBQ3RCLG9CQUFvQixFQUFFLEVBQUU7WUFDeEIsdUNBQXVDLEVBQUUsTUFBTTtZQUMvQyw0QkFBNEIsRUFBRSw2REFBNkQ7U0FDOUY7S0FDSixDQUFDLENBQUM7SUFDSCxDQUFDLEdBQUcsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN2QixlQUFlLEdBQUcsQ0FBQyxDQUFDLGlDQUFpQyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDN0QsU0FBUyxHQUFHLENBQUMsQ0FBQywyQkFBMkIsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBRWpELG1DQUFtQztJQUVuQyxPQUFPLENBQUMsR0FBRyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7SUFDckQsSUFBSSxHQUFHLE1BQU0sT0FBTyxDQUFDO1FBQ2pCLEdBQUcsRUFBRSx1Q0FBdUM7UUFDNUMsR0FBRyxFQUFFLEdBQUc7UUFDUixNQUFNLEVBQUUsTUFBTTtRQUNkLGtCQUFrQixFQUFFLElBQUk7UUFDeEIsSUFBSSxFQUFFO1lBQ0YsZUFBZSxFQUFFLEdBQUc7WUFDcEIsYUFBYSxFQUFFLCtFQUErRTtZQUM5RixpQkFBaUIsRUFBRSxlQUFlO1lBQ2xDLFdBQVcsRUFBRSxTQUFTO1NBQ3pCO0tBQ0osQ0FBQyxDQUFDO0lBQ0gsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDdkIsZUFBZSxHQUFHLENBQUMsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBQzdELFNBQVMsR0FBRyxDQUFDLENBQUMsMkJBQTJCLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUVqRCx5REFBeUQ7SUFFekQsSUFBSSxRQUFRLEdBQUcsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRSxRQUFRLENBQUMsQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDbkUsSUFBSSxNQUFNLEdBQUcsTUFBTSxFQUFFLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBRTNDLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0RBQWdELFFBQVEsT0FBTyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0lBQ3RGLElBQUksR0FBRyxNQUFNLE9BQU8sQ0FBQztRQUNqQixHQUFHLEVBQUUsdUNBQXVDO1FBQzVDLEdBQUcsRUFBRSxHQUFHO1FBQ1IsTUFBTSxFQUFFLE1BQU07UUFDZCxrQkFBa0IsRUFBRSxJQUFJO1FBQ3hCLElBQUksRUFBRTtZQUNGLGlCQUFpQixFQUFFLGVBQWU7WUFDbEMsV0FBVyxFQUFFLFNBQVM7WUFDdEIsOEVBQThFLEVBQUUsSUFBSTtZQUNwRixrRUFBa0UsRUFBRSxRQUFRO1lBQzVFLDJGQUEyRixFQUFFLG9CQUFvQjtZQUNqSCxrR0FBa0csRUFBRSxRQUFRO1lBQzVHLGdHQUFnRyxFQUFFLE1BQU07U0FDM0c7S0FDSixDQUFDLENBQUM7SUFDSCxDQUFDLEdBQUcsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN2QixlQUFlLEdBQUcsQ0FBQyxDQUFDLGlDQUFpQyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUM7SUFDN0QsU0FBUyxHQUFHLENBQUMsQ0FBQywyQkFBMkIsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBRWpELGdEQUFnRDtJQUVoRCxJQUFJLFVBQVUsR0FBRyxDQUFDLENBQUM7SUFDbkIsSUFBSSxhQUFhLEdBQUcsQ0FBQyxDQUFDLHVEQUF1RCxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDdEYsSUFBSSxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsTUFBTSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFFLG9DQUFvQztJQUVsSCxHQUFHO1FBQ0MsNENBQTRDO1FBRTVDLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLFVBQVUsT0FBTyxTQUFTLEdBQUcsQ0FBQyxDQUFDO1FBQzNELFVBQVUsRUFBRSxDQUFDO1FBRWIsS0FBSyxJQUFJLFFBQVEsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUU7WUFDaEMsSUFBSSxVQUFVLEdBQUcsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUNsRCxJQUFJLFVBQVUsQ0FBQyxNQUFNLElBQUksQ0FBQyxFQUFFO2dCQUN4QixJQUFJLGlCQUFpQixHQUFHLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQTtnQkFDdEQsSUFBSSxZQUFZLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsRUFBRSxXQUFXLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBRSxtREFBbUQ7Z0JBQ2xJLElBQUksV0FBVyxHQUFHLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQztnQkFFakQsSUFBSSxVQUFVLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLElBQUksWUFBWSxDQUFDLE9BQU8sRUFBRSxFQUFFO29CQUM5RCw0RUFBNEU7b0JBQzVFLDZFQUE2RTtvQkFDN0UsNkVBQTZFO29CQUM3RSxnQ0FBZ0M7b0JBRWhDLElBQUksY0FBYyxHQUFHLEdBQUcsOEJBQThCLG1CQUFtQixDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO29CQUN2SCxJQUFJLE9BQU8sR0FBRyxNQUFNLG1CQUFtQixDQUFDLGNBQWMsRUFBRSxHQUFHLENBQUMsQ0FBQztvQkFFN0QsSUFBSSxPQUFPLEtBQUssU0FBUyxJQUFJLE9BQU8sS0FBSyxFQUFFLEVBQUU7d0JBQ3pDLE1BQU0sU0FBUyxDQUFDLFFBQVEsRUFBRTs0QkFDdEIsaUJBQWlCLEVBQUUsaUJBQWlCOzRCQUNwQyxPQUFPLEVBQUUsT0FBTzs0QkFDaEIsV0FBVyxFQUFFLENBQUMsQ0FBQyxXQUFXLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLHlCQUF5QixDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUM7NEJBQzdFLGNBQWMsRUFBRSxpQ0FBaUM7NEJBQ2pELFVBQVUsRUFBRSxVQUFVOzRCQUN0QixVQUFVLEVBQUUsTUFBTSxFQUFFLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQzs0QkFDekMsWUFBWSxFQUFFLFlBQVksQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRTt5QkFDaEYsQ0FBQyxDQUFDO3FCQUNOO2lCQUNKO2FBQ0o7U0FDSjtRQUVELElBQUksVUFBVSxHQUFHLFNBQVM7WUFDdEIsTUFBTTtRQUVWLHlEQUF5RDtRQUV6RCxPQUFPLENBQUMsR0FBRyxDQUFDLGtEQUFrRCxVQUFVLE9BQU8sU0FBUyxJQUFJLENBQUMsQ0FBQztRQUM5RixJQUFJLEdBQUcsTUFBTSxPQUFPLENBQUM7WUFDakIsR0FBRyxFQUFFLEdBQUcsNENBQTRDLGVBQWUsVUFBVSxFQUFFO1lBQy9FLEdBQUcsRUFBRSxHQUFHO1lBQ1IsTUFBTSxFQUFFLE1BQU07WUFDZCxrQkFBa0IsRUFBRSxJQUFJO1lBQ3hCLElBQUksRUFBRTtnQkFDRixlQUFlLEVBQUUsRUFBRTtnQkFDbkIsYUFBYSxFQUFFLG1EQUFtRCxVQUFVLEVBQUU7Z0JBQzlFLGlCQUFpQixFQUFFLGVBQWU7Z0JBQ2xDLFdBQVcsRUFBRSxTQUFTO2FBQ3pCO1NBQ0osQ0FBQyxDQUFDO1FBQ0gsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDdkIsZUFBZSxHQUFHLENBQUMsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQzdELFNBQVMsR0FBRyxDQUFDLENBQUMsMkJBQTJCLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQztLQUNwRCxRQUFRLFNBQVMsS0FBSyxJQUFJLElBQUksVUFBVSxJQUFJLFNBQVMsSUFBSSxVQUFVLElBQUksRUFBRSxFQUFDLENBQUUsNERBQTREO0FBQzdJLENBQUM7QUFFRCxJQUFJLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyJ9