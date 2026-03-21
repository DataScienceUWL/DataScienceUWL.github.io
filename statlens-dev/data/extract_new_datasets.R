#!/usr/bin/env Rscript
# Extract new datasets for StatLens (high + medium priority)
# Run: Rscript data/extract_new_datasets.R

library(jsonlite)
library(openintro)

outdir <- "/home/jbaggett/statlens/data"

write_dataset <- function(data, filename, meta) {
  out <- c(meta, list(rows = data))
  writeLines(toJSON(out, auto_unbox = TRUE, digits = 4), file.path(outdir, filename))
  cat("  wrote", filename, "—", nrow(data), "rows\n")
}

# ============================================================
# HIGH PRIORITY (7 datasets)
# ============================================================

# 1. avandia — cardiovascular outcomes RCT (Ch 7, randomization test)
# 227K rows is too large for browser JSON. Downsample proportionally to ~2000 rows.
cat("avandia...\n")
d <- openintro::avandia
d$treatment <- as.character(d$treatment)
d$cardiovascular_problems <- as.character(d$cardiovascular_problems)
names(d) <- c("group", "outcome")
# Proportional downsample: preserve event rates
set.seed(42)
d <- d[sample(nrow(d), 2000), ]
write_dataset(d, "avandia.json", list(
  id = "avandia",
  name = "Avandia Cardiovascular Outcomes",
  description = "Cardiovascular event outcomes for rosiglitazone (Avandia) vs. pioglitazone across clinical trials (proportional sample, n=2000). IMS Ch. 7.",
  source = "openintro",
  chapter = "IMS Ch. 7",
  type = "randomization_prop",
  variables = list(
    list(name = "group", label = "Treatment Group", type = "categorical"),
    list(name = "outcome", label = "Cardiovascular Event", type = "categorical")
  ),
  studyDescription = "A meta-analysis combining data from multiple randomized controlled trials of rosiglitazone (Avandia) and pioglitazone, both diabetes medications. Patients were randomly assigned to one of the two drugs. The outcome tracked was whether each patient experienced cardiovascular problems. This is a proportional subsample of the original 227,571 patients.",
  variableDescriptions = list(
    group = "Whether the patient received Rosiglitazone (Avandia) or Pioglitazone.",
    outcome = "Whether the patient experienced cardiovascular problems (yes/no)."
  ),
  sourceDetail = "OpenIntro IMS, Chapter 7. Based on Nissen & Wolski (2007). Proportionally downsampled from 227,571 to 2,000 observations.",
  context = list(
    population = "diabetes patients in clinical trials",
    parameter = "difference in cardiovascular event rate",
    nullClaim = "there is no difference in cardiovascular event rate between rosiglitazone and pioglitazone",
    successLabel = "yes"
  )
))

# 2. Cuckoo — egg lengths by host bird species (Ch 16, ANOVA)
cat("cuckoo...\n")
library(Stat2Data)
data(Cuckoo)
d <- Cuckoo[, c("Bird", "Length")]
d$Bird <- as.character(d$Bird)
names(d) <- c("group", "length")
write_dataset(d, "cuckoo.json", list(
  id = "cuckoo",
  name = "Cuckoo Egg Lengths",
  description = "Lengths (mm) of cuckoo eggs found in nests of 6 different host bird species. n=120. IMS Ch. 16.",
  source = "Stat2Data",
  chapter = "IMS Ch. 16",
  type = "anova",
  variables = list(
    list(name = "group", label = "Host Bird Species", type = "categorical"),
    list(name = "length", label = "Egg Length (mm)", type = "numeric")
  ),
  studyDescription = "Researchers measured the lengths of cuckoo eggs found in the nests of six different host bird species. Cuckoos are brood parasites — they lay their eggs in the nests of other bird species. This observational study collected 120 eggs across host species to investigate whether cuckoo egg size varies by host species.",
  variableDescriptions = list(
    group = "The host bird species in whose nest the cuckoo egg was found (e.g., Hedge Sparrow, Meadow Pipit, Pied Wagtail, Robin, Tree Pipit, Wren).",
    length = "The length of the cuckoo egg in millimeters."
  ),
  sourceDetail = "Stat2Data R package. Original data from Latter (1902), published in Biometrika.",
  context = list(
    population = "cuckoo eggs",
    parameter = "mean egg length across host species"
  )
))

# 3. gss2010 — General Social Survey (Ch 16, ANOVA)
cat("gss2010...\n")
d <- openintro::gss2010[, c("degree", "hrsrelax")]
d <- na.omit(d)
d$degree <- as.character(d$degree)
names(d) <- c("group", "hours")
d$group <- as.character(d$group)
write_dataset(d, "gss2010.json", list(
  id = "gss2010",
  name = "GSS: Relaxation by Education",
  description = "Hours per day spent relaxing by education level (5 groups) from 2010 General Social Survey. IMS Ch. 16.",
  source = "openintro",
  chapter = "IMS Ch. 16",
  type = "anova",
  variables = list(
    list(name = "group", label = "Education Level", type = "categorical"),
    list(name = "hours", label = "Hours Relaxing per Day", type = "numeric")
  ),
  studyDescription = "Data from the 2010 General Social Survey (GSS), a nationally representative survey of US adults. Respondents reported their highest educational degree and the number of hours per day they spend relaxing. Education levels range from less than high school to graduate degree.",
  variableDescriptions = list(
    group = "Highest educational degree: Less than high school, High school, Junior college, Bachelor, or Graduate.",
    hours = "Self-reported number of hours per day spent relaxing."
  ),
  sourceDetail = "OpenIntro IMS, Chapter 16 exercise. Data from NORC General Social Survey (2010).",
  context = list(
    population = "US adults",
    parameter = "mean relaxation hours across education levels"
  )
))

# 4. chickwts — chicken weights by feed type (Ch 12, ANOVA)
cat("chickwts...\n")
d <- chickwts
d$feed <- as.character(d$feed)
names(d) <- c("weight", "group")
d <- d[, c("group", "weight")]
write_dataset(d, "chickwts.json", list(
  id = "chickwts",
  name = "Chicken Weights by Feed",
  description = "Weights (g) of chicks after 6 weeks on one of 6 different feed supplements. n=71. IMS Ch. 12.",
  source = "datasets (base R)",
  chapter = "IMS Ch. 12",
  type = "anova",
  variables = list(
    list(name = "group", label = "Feed Supplement", type = "categorical"),
    list(name = "weight", label = "Weight (g)", type = "numeric")
  ),
  studyDescription = "An experiment measuring the weights of chicks after six weeks on one of six different feed supplements: casein, horsebean, linseed, meatmeal, soybean, or sunflower. Chicks were randomly assigned to feed types. The dataset contains 71 observations.",
  variableDescriptions = list(
    group = "The type of feed supplement the chick received: casein, horsebean, linseed, meatmeal, soybean, or sunflower.",
    weight = "The weight of the chick in grams after six weeks on the assigned feed."
  ),
  sourceDetail = "Base R datasets package. Originally from McNab (1990).",
  context = list(
    population = "chicks",
    parameter = "mean weight across feed types"
  )
))

# 5. cats — body weight vs heart weight (Ch 19-20, regression)
cat("cats...\n")
library(MASS)
d <- MASS::cats[, c("Bwt", "Hwt")]
names(d) <- c("body_wt", "heart_wt")
write_dataset(d, "cats.json", list(
  id = "cats",
  name = "Cat Body & Heart Weight",
  description = "Body weight (kg) and heart weight (g) for 144 domestic cats. IMS Ch. 19-20.",
  source = "MASS",
  chapter = "IMS Ch. 19-20",
  type = "regression",
  variables = list(
    list(name = "body_wt", label = "Body Weight (kg)", type = "numeric"),
    list(name = "heart_wt", label = "Heart Weight (g)", type = "numeric")
  ),
  studyDescription = "Anatomical measurements of 144 domestic cats used in experiments at the University of Bristol. Body weight (kg) and heart weight (g) were recorded for each cat. The dataset includes both male and female cats.",
  variableDescriptions = list(
    body_wt = "The body weight of the cat in kilograms.",
    heart_wt = "The heart weight of the cat in grams."
  ),
  sourceDetail = "MASS R package. Originally from Fisher (1947).",
  context = list(
    population = "domestic cats",
    parameter = "slope of heart weight on body weight"
  )
))

# 6. exam_grades — exam scores (Ch 18-19, correlation/regression)
cat("exam_grades...\n")
d <- openintro::exam_grades[, c("exam1", "exam2")]
d <- na.omit(d)
write_dataset(d, "exam_grades.json", list(
  id = "exam_grades",
  name = "Exam 1 vs. Exam 2 Scores",
  description = "Exam 1 and Exam 2 scores for statistics students. IMS Ch. 18-19.",
  source = "openintro",
  chapter = "IMS Ch. 18-19",
  type = "regression",
  variables = list(
    list(name = "exam1", label = "Exam 1 Score", type = "numeric"),
    list(name = "exam2", label = "Exam 2 Score", type = "numeric")
  ),
  studyDescription = "Exam scores from an introductory statistics course. Each student's Exam 1 and Exam 2 scores are recorded. This observational dataset allows exploration of whether performance on the first exam predicts performance on the second.",
  variableDescriptions = list(
    exam1 = "The student's score on Exam 1.",
    exam2 = "The student's score on Exam 2."
  ),
  sourceDetail = "OpenIntro IMS, Chapters 18-19.",
  context = list(
    population = "statistics students",
    parameter = "slope of Exam 2 score on Exam 1 score"
  )
))

# 7. trees — cherry tree measurements (Ch 18, regression)
cat("trees...\n")
d <- trees[, c("Girth", "Volume")]
names(d) <- c("diameter", "volume")
write_dataset(d, "trees.json", list(
  id = "trees",
  name = "Cherry Tree Diameter & Volume",
  description = "Diameter (in) and timber volume (cu ft) for 31 black cherry trees. IMS Ch. 18.",
  source = "datasets (base R)",
  chapter = "IMS Ch. 18",
  type = "regression",
  variables = list(
    list(name = "diameter", label = "Diameter (in)", type = "numeric"),
    list(name = "volume", label = "Volume (cu ft)", type = "numeric")
  ),
  studyDescription = "Measurements of 31 black cherry trees in the Allegheny National Forest, Pennsylvania. Diameter (originally labeled 'Girth' but actually diameter at 4.5 ft) and timber volume were measured for each tree. The relationship is nonlinear, making this useful for illustrating when linear regression assumptions may be violated.",
  variableDescriptions = list(
    diameter = "The diameter of the tree trunk in inches, measured at 4.5 feet above ground (DBH).",
    volume = "The usable timber volume of the tree in cubic feet."
  ),
  sourceDetail = "Base R datasets package. Originally from Ryan, Joiner, and Ryan (1976), Minitab Handbook.",
  context = list(
    population = "black cherry trees",
    parameter = "slope of volume on diameter"
  )
))

# ============================================================
# MEDIUM PRIORITY (5 datasets — diamond skipped, not in openintro)
# ============================================================

# 8. antibiotics — conditions (Ch 3, 5, one-categorical)
cat("antibiotics...\n")
d <- openintro::antibiotics[, "condition", drop = FALSE]
d$condition <- as.character(d$condition)
write_dataset(d, "antibiotics.json", list(
  id = "antibiotics",
  name = "Antibiotic Use by Condition",
  description = "Medical conditions requiring antibiotic treatment. n=92. IMS Ch. 3, 5.",
  source = "openintro",
  chapter = "IMS Ch. 3, 5",
  type = "one_cat",
  variables = list(
    list(name = "condition", label = "Medical Condition", type = "categorical")
  ),
  studyDescription = "Data on 92 cases of antibiotic use classified by the underlying medical condition. Conditions include cardiovascular, gastrointestinal, genetic/metabolic, immunocompromised, neuromuscular, prematurity, respiratory, and trauma. Used in the textbook for categorical data exploration.",
  variableDescriptions = list(
    condition = "The medical condition category for which antibiotics were prescribed (8 categories)."
  ),
  sourceDetail = "OpenIntro IMS, Chapters 3 and 5."
))

# 9. county_2019 — updated county data (Ch 19, regression)
cat("county_2019...\n")
library(usdata)
d <- usdata::county_2019
# Use key numeric variables that exist in this version
cols <- intersect(c("median_household_income", "median_hh_income", "poverty", "unemployment_rate"), names(d))
cat("  available columns:", paste(cols, collapse=", "), "\n")
# Try to get useful regression variables
d2 <- data.frame(
  median_income = d$median_household_income,
  poverty = d$poverty,
  unemployment = d$unemployment_rate
)
d2 <- na.omit(d2)
write_dataset(d2, "county_2019.json", list(
  id = "county_2019",
  name = "US County Demographics (2019)",
  description = "Median household income, poverty rate, and unemployment rate for US counties (2019). IMS Ch. 19.",
  source = "usdata",
  chapter = "IMS Ch. 19",
  type = "regression",
  variables = list(
    list(name = "median_income", label = "Median Household Income ($)", type = "numeric"),
    list(name = "poverty", label = "Poverty Rate (%)", type = "numeric"),
    list(name = "unemployment", label = "Unemployment Rate (%)", type = "numeric")
  ),
  studyDescription = "County-level demographic data from the American Community Survey (2019) for US counties. Variables include economic indicators. This is an observational dataset spanning nearly all US counties.",
  variableDescriptions = list(
    median_income = "The median household income in the county in US dollars.",
    poverty = "The percentage of the county population living below the federal poverty line.",
    unemployment = "The unemployment rate in the county as a percentage."
  ),
  sourceDetail = "usdata R package. Based on American Community Survey 2019 estimates."
))

# 10. urban_owner — homeownership vs urbanization (Ch 19-20, regression)
cat("urban_owner...\n")
d <- usdata::urban_owner[, c("state", "poppct_urban", "pct_owner_occupied")]
d <- na.omit(d)
d$state <- as.character(d$state)
write_dataset(d, "urban_owner.json", list(
  id = "urban_owner",
  name = "Homeownership vs. Urbanization",
  description = "Homeownership rate (%) vs. urban population (%) for 52 US states/territories. IMS Ch. 19-20.",
  source = "usdata",
  chapter = "IMS Ch. 19-20",
  type = "regression",
  variables = list(
    list(name = "state", label = "State", type = "categorical"),
    list(name = "poppct_urban", label = "Urban Population (%)", type = "numeric"),
    list(name = "pct_owner_occupied", label = "Homeownership Rate (%)", type = "numeric")
  ),
  studyDescription = "State-level data on the percentage of the population living in urban areas and the homeownership rate. Data cover 50 US states plus DC and Puerto Rico.",
  variableDescriptions = list(
    state = "US state or territory name.",
    poppct_urban = "The percentage of the state's population living in urban areas.",
    pct_owner_occupied = "The percentage of housing units in the state that are owner-occupied."
  ),
  sourceDetail = "usdata R package. Based on US Census Bureau data. IMS Chapters 19-20.",
  context = list(
    population = "US states",
    parameter = "slope of homeownership rate on urbanization"
  )
))

# 11. oscars — award-winning actor/actress ages (Ch 5, numerical exploration)
cat("oscars...\n")
d <- openintro::oscars[, c("oscar_yr", "age", "award")]
d <- na.omit(d)
d$award <- as.character(d$award)
names(d) <- c("year", "age", "award")
write_dataset(d, "oscars.json", list(
  id = "oscars",
  name = "Oscar Winner Ages",
  description = "Ages of Best Actor and Best Actress Oscar winners by year. n=184. IMS Ch. 5.",
  source = "openintro",
  chapter = "IMS Ch. 5",
  type = "explore",
  variables = list(
    list(name = "year", label = "Year", type = "numeric"),
    list(name = "age", label = "Age at Award", type = "numeric"),
    list(name = "award", label = "Award Category", type = "categorical")
  ),
  studyDescription = "Ages of Academy Award (Oscar) winners for Best Actor and Best Actress categories from 1929 to 2020. This observational dataset captures the age at which each winner received their award.",
  variableDescriptions = list(
    year = "The year the Oscar was awarded.",
    age = "The age of the winner at the time of the award ceremony.",
    award = "The award category: Best actress or Best actor."
  ),
  sourceDetail = "OpenIntro IMS, Chapter 5. Data compiled from Academy Awards records."
))

# 12. mammals — sleep, brain, body data (Ch 5, scatterplot)
cat("mammals...\n")
d <- openintro::mammals[, c("total_sleep", "brain_wt", "body_wt", "gestation")]
d <- na.omit(d)
write_dataset(d, "mammals.json", list(
  id = "mammals",
  name = "Mammal Sleep & Body Data",
  description = "Sleep hours, brain weight, body weight, and gestation for mammals. IMS Ch. 5.",
  source = "openintro",
  chapter = "IMS Ch. 5",
  type = "explore",
  variables = list(
    list(name = "total_sleep", label = "Total Sleep (hrs/day)", type = "numeric"),
    list(name = "brain_wt", label = "Brain Weight (g)", type = "numeric"),
    list(name = "body_wt", label = "Body Weight (kg)", type = "numeric"),
    list(name = "gestation", label = "Gestation (days)", type = "numeric")
  ),
  studyDescription = "Biological data on mammal species including total daily sleep, brain weight, body weight, and gestation period. This observational dataset includes a wide variety of mammal species from small to very large.",
  variableDescriptions = list(
    total_sleep = "Total hours of sleep per day for the species.",
    brain_wt = "Average brain weight in grams.",
    body_wt = "Average body weight in kilograms.",
    gestation = "Average gestation period in days."
  ),
  sourceDetail = "OpenIntro IMS, Chapter 5. Originally from Allison & Cicchetti (1976)."
))

cat("\nDone! 12 datasets extracted (diamond skipped — not found in openintro).\n")
