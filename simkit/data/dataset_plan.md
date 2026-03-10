# SimKit Dataset Plan

Complete inventory of OpenIntro/IMS datasets, mapped to SimKit page types and IMS chapters.

## Legend

- **Status**: ✅ = bundled in SimKit, ☐ = not yet added
- **SimKit type**: which `type` value in datasets.json / which page(s) can use it
- **IMS Ch.**: chapter reference (T = text/example, E = exercise)

## Currently Bundled (46 datasets)

See `datasets.json` for full list.

---

## Priority Additions — IMS Text Examples

These appear as primary worked examples in IMS chapters. Students will encounter them directly.

### Two Independent Means (Ch. 20)
| Dataset | n | Variables | Status | Notes |
|---------|---|-----------|--------|-------|
| stem_cell | 18 | group, change | ✅ | ESC treatment vs control |
| births14_smoke | 981 | group, weight | ✅ | Smoker vs nonsmoker birth weight |
| ncbirths_smoke | 999 | group, weight | ✅ | Same concept, 2004 NC data |
| classdata | 164 | lecture, m1 | ☐ | Exam scores, versions A vs B (text example) |
| lizard_run | 48 | group, top_speed | ✅ | Two species sprint speed (exercise) |
| epa2021_mpg | 200 | group, mpg | ✅ | Auto vs manual MPG (exercise) |

### Paired Means (Ch. 21)
| Dataset | n | Variables | Status | Notes |
|---------|---|-----------|--------|-------|
| textbooks | 73 | ucla, amazon | ✅ | UCLA vs Amazon prices (text) |
| hsb2_read_write | 200 | read, write | ✅ | Same students, two tests (exercise) |
| friday_traffic | 61 | sixth, thirteenth | ✅ | Friday 6th vs 13th (exercise) |
| helium | 39 | air, helium | ✅ | Kick distance (exercise) |
| us_temperature | 18759 raw | location, tmax by year | ☐ | 1950 vs 2022 temps (exercise) — needs preprocessing |
| twins | 27 | foster, biological | ☐ | IQ scores of twins raised apart |
| prison | 14 | pre_trt, post_trt | ☐ | Before/after treatment MMPI scores |

### One Proportion (Ch. 12, 16)
| Dataset | n | Variables | Status | Notes |
|---------|---|-----------|--------|-------|
| medical_consultant | 62 | outcome | ✅ | Complication rate vs 10% (text) |
| transplant_survival | 34 | outcome | ✅ | Bootstrap CI for survival rate |
| stent30 | 224 | outcome | ✅ | Stroke rate for stent patients |

### Two Proportions (Ch. 11, 17)
| Dataset | n | Variables | Status | Notes |
|---------|---|-----------|--------|-------|
| sex_discrimination | 48 | sex, decision | ✅ | Gender bias in promotions (text Ch. 11) |
| opportunity_cost | 150 | group, decision | ✅ | Purchase framing (text Ch. 11) |
| cpr | 90 | group, outcome | ✅ | Blood thinner survival (text Ch. 14, 17) |
| yawn | 50 | group, result | ✅ | Contagious yawning (exercise) |
| heart_transplant | 103 | group, outcome | ✅ | Transplant survival (exercise) |
| malaria | 20 | group, outcome | ✅ | Vaccine trial (text Ch. 15) |
| migraine | 89 | group, outcome | ✅ | Acupuncture trial |
| fish_oil_18 | ? | group, outcome | ☐ | Fish oil and heart attacks (text Ch. 17) |
| mammogram | 89835 | group, outcome | ☐ | 30-year screening study (text Ch. 17) |
| avandia | 227571 | treatment, outcome | ☐ | Drug safety (exercise) — very large |
| smallpox | 6224 | result, inoculated | ☐ | Historical inoculation data |
| biontech_adolescents | 2260 | group, outcome | ☐ | COVID vaccine trial |
| sinusitis | 166 | group, outcome | ☐ | Antibiotic treatment |

### Chi-Square (Ch. 18)
| Dataset | n | Variables | Status | Notes |
|---------|---|-----------|--------|-------|
| ask | 219 | question_class, response | ✅ | Question framing (text) |
| diabetes2 | 699 | treatment, outcome | ✅ | 3 treatments (text) |
| lizard_habitat | 332 | site, sunlight | ✅ | 3×3 table (exercise) |
| immigration | 910 | political, response | ✅ | 4 groups (exercise) |

### Regression (Ch. 7, 24)
| Dataset | n | Variables | Status | Notes |
|---------|---|-----------|--------|-------|
| elmhurst_regression | 50 | family_income, gift_aid | ✅ | Negative slope (text Ch. 7, 24) |
| possum_regression | 104 | skull_w, head_l | ✅ | Body measurements (text Ch. 7) |
| mariokart_regression | 59 | n_bids, total_pr | ✅ | eBay auctions (text Ch. 7, 27) |
| ames_regression | 2930 | area, price | ✅ | Home prices (text) |
| bac | 16 | beers, bac | ✅ | Strong linear (exercise Ch. 24) |
| duke_forest | 98 | area, price | ✅ | Durham homes (text Ch. 10) |
| starbucks | 77 | calories, protein | ✅ | Menu items (exercise Ch. 7) |
| babies_crawl | 12 | temperature, avg_crawling_age | ✅ | Tiny dataset (exercise) |
| births14 (weeks→weight) | 1000 | weeks, weight | ☐ | Gestation → birth weight (text Ch. 24) |
| midterms_house | 31 | unemp, house_change | ☐ | Midterm elections (text Ch. 24) |
| coast_starlight (dist→time) | 16 | dist, travel_time | ☐ | Already have 1-var; add 2-var version |
| cherry | 31 | diam, volume | ☐ | Tree diameter vs volume (exercise Ch. 25) |
| satgpa | 1000 | sat_sum, fy_gpa | ☐ | SAT → college GPA |
| gpa_study_hours | 193 | study_hours, gpa | ☐ | Relatable to students |
| evals | 463 | bty_avg, score | ☐ | Teaching evals (controversial but engaging) |
| gifted | 36 | motheriq, score | ☐ | Parent IQ → child aptitude |

### One Mean (Ch. 12, 19)
| Dataset | n | Variables | Status | Notes |
|---------|---|-----------|--------|-------|
| penny_ages | 648 | age | ✅ | Classic bootstrap example |
| coast_starlight | 16 | travel_time | ✅ | Small sample |
| dolphins_mercury | 19 | mercury | ✅ | Small sample |
| bdims_hgt | 507 | hgt | ✅ | Heights |
| births14_weight | 1000 | weight | ✅ | Birth weights |
| loan50_interest | 50 | interest_rate | ✅ | Lending Club |
| run17 | 100 | time_min | ✅ | Cherry Blossom race |
| nba_heights | 435 | height | ✅ | Approximately normal |
| ball_bearing | 75 | life_span | ☐ | Engineering context |
| manhattan | 20 | rent | ☐ | NYC apartment rent |

### EDA / Explore (Ch. 2, 4, 5)
| Dataset | n | Variables | Status | Notes |
|---------|---|-----------|--------|-------|
| ames_price | 2930 | price | ✅ | Right-skewed |
| ames_area | 2930 | area | ✅ | Right-skewed |
| email50_num_char | 50 | num_char | ✅ | Right-skewed |
| county_pop/poverty/income | 3137 | various | ✅ | Multiple extracts |
| loan50_income/amount | 50 | various | ✅ | Multiple extracts |
| fastfood_calories | 515 | calories | ✅ | Right-skewed |
| pm25_2022_durham | 356 | daily_mean | ☐ | Air quality (exercise Ch. 5) |
| nyc_marathon | 108 | time_hrs | ☐ | Marathon times (exercise Ch. 5) |

### Logistic Regression (Ch. 9, 26) — Future
| Dataset | n | Variables | Status | Notes |
|---------|---|-----------|--------|-------|
| resume | 4870 | race, callback | ☐ | Job discrimination (text Ch. 9) |
| email | 3921 | spam + predictors | ☐ | Spam classification (text Ch. 26) |
| possum | 104 | sex + measurements | ☐ | Species classification |

### ANOVA (Ch. 22) — Future
| Dataset | n | Variables | Status | Notes |
|---------|---|-----------|--------|-------|
| mlb_players_18 | 1270 | position, OBP | ☐ | On-base % by position (text) |
| classdata | 164 | lecture (3 groups), m1 | ☐ | Three exam versions (text) |
| gss2010 | 2044 | degree, hrsrelax | ☐ | Relaxation by education (exercise) |

---

## Categorical / Contingency Table Datasets (explore/categorical page)

| Dataset | n | Variables | Status | Notes |
|---------|---|-----------|--------|-------|
| loans_full_schema | 10000 | homeownership, application_type, grade, ... | ☐ | Primary Ch. 4 example |
| email | 3921 | spam, format, number, ... | ☐ | Ch. 4, multiple categoricals |
| antibiotics | 92 | condition | ☐ | Ch. 4 |
| smoking | 1691 | gender, marital_status, smoke, ... | ☐ | Multiple categoricals |
| ucb_admit | 4526 | admit, gender, dept | ☐ | Simpson's paradox |
| assortative_mating | 204 | self_male, partner_female | ☐ | Eye color matching |
| drug_use | 445 | student, parents | ☐ | Parent/student drug use |
| health_coverage | 20000 | coverage, health_status | ☐ | Large contingency |

---

## Rich Metadata Schema

Each dataset JSON should include:

```json
{
  "id": "stem_cell",
  "name": "Stem Cell Heart Repair",
  "description": "Short description for dropdown menus",
  "details": "Longer pedagogical description for info overlay. Can include study design, source citation, context about why this dataset matters.",
  "source": "openintro::stem_cell",
  "citation": "Menard C, et al. (2005). Transplantation of cardiac-committed mouse embryonic stem cells to infarcted sheep myocardium. The Lancet, 366(9490), 1005-1012.",
  "chapter": "IMS Ch. 20",
  "chapterUsage": "text",
  "type": "randomization",
  "tags": ["two-sample", "means", "experiment", "medical"],
  "n": 18,
  "variables": [
    {
      "name": "group",
      "label": "Treatment Group",
      "type": "categorical",
      "levels": ["Control", "Treatment"],
      "description": "Whether the sheep received embryonic stem cell treatment or a control"
    },
    {
      "name": "change",
      "label": "Change in Heart Function",
      "type": "numeric",
      "unit": "percentage points",
      "description": "Change in heart pumping capacity (after − before)"
    }
  ],
  "context": {
    "population": "sheep with heart damage",
    "parameter": "difference in mean change in heart function",
    "nullClaim": "stem cell treatment has no effect on change in heart pumping capacity",
    "studyDesign": "randomized experiment",
    "yearCollected": 2005
  },
  "rows": [...]
}
```

## Next Steps

1. Add `classdata`, `twins`, `prison`, `births14_regression`, `midterms_house`, `coast_starlight_regression` datasets
2. Enrich existing dataset JSONs with `details`, `citation`, `tags`, `chapterUsage`, variable `description` and `levels`
3. Build dataset info overlay UI component
4. Add `fish_oil_18`, `mammogram`, `biontech_adolescents` for two-proportion inference
5. Add `loans_full_schema` extract for categorical exploration
6. Add `mlb_players_18` for future ANOVA page
