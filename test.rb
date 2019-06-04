require 'scraperwiki'
require 'yaml'

File.delete("./data.sqlite") if File.exist?("./data.sqlite")

puts "Running original scraper..."
system(". ~/.nvm/nvm.sh; nvm run 10.6.0 scraper.js")

results_original = ScraperWiki.select("* from data order by council_reference")
# it looks like php scraperwiki library throws in an id. Ignore that.
results_original = results_original.each{|h| h.delete("id")}
ScraperWiki.close_sqlite

File.open("results_original.yml", "w") do |f|
  f.write(results_original.to_yaml)
end

File.delete("./data.sqlite") if File.exist?("./data.sqlite")

puts "Running ruby scraper..."
system("bundle exec ruby scraper.rb")

results_ruby = ScraperWiki.select("* from data order by council_reference")

File.open("results_ruby.yml", "w") do |f|
  f.write(results_ruby.to_yaml)
end

if results_ruby == results_original
  puts "Succeeded"
else
  raise "Failed"
end
