require "epathway_scraper"

records = []
EpathwayScraper.scrape_and_save(
  "https://epayments.barossa.sa.gov.au/ePathway/Production",
  list_type: :last_30_days
)
