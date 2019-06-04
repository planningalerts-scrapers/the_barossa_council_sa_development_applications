require "epathway_scraper"

EpathwayScraper.scrape(
  "https://epayments.barossa.sa.gov.au/ePathway/Production",
  list_type: :last_30_days
) do |record|
  record["address"] = record["address"].squeeze(" ")

  EpathwayScraper.save(record)
end