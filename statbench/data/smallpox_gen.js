// Temporary script to generate corrected smallpox.json
// Run: node data/smallpox_gen.js
// Then delete this file

const fs = require('fs');
const path = require('path');

const rows = [];
// Inoculated: 6 died, 232 survived (238 total)
for (let i = 0; i < 232; i++) rows.push({ group: "inoculated", outcome: "survived" });
for (let i = 0; i < 6; i++) rows.push({ group: "inoculated", outcome: "died" });
// Not inoculated: 844 died, 5142 survived (5986 total)
for (let i = 0; i < 5142; i++) rows.push({ group: "not inoculated", outcome: "survived" });
for (let i = 0; i < 844; i++) rows.push({ group: "not inoculated", outcome: "died" });

const data = {
  id: "smallpox",
  name: "Smallpox Inoculation",
  description: "Smallpox outcomes for 6,224 residents of Boston during the 1721 outbreak: inoculated vs not inoculated. Historical data.",
  source: "openintro",
  chapter: "",
  type: "randomization_prop",
  variables: [
    { name: "group", label: "Inoculation Status", type: "categorical" },
    { name: "outcome", label: "Outcome", type: "categorical" }
  ],
  context: {
    population: "Boston residents during the 1721 smallpox outbreak",
    parameter: "difference in death rate",
    nullClaim: "inoculation has no effect on the smallpox death rate",
    successLabel: "died"
  },
  rows: rows,
  inferenceContexts: [
    {
      test: "two-props",
      groupVar: "group",
      responseVar: "outcome",
      successLabel: "died",
      group1: "inoculated",
      group2: "not inoculated",
      alternative: "less",
      parameter: "the difference in death rates between inoculated and not inoculated groups",
      claim: "inoculation reduces the death rate from smallpox"
    },
    {
      test: "chisq",
      groupVar: "group",
      responseVar: "outcome",
      parameter: "the association between inoculation status and smallpox outcome",
      claim: "there is an association between inoculation status and whether a person died from smallpox"
    }
  ]
};

// Verify counts
const counts = {};
rows.forEach(r => {
  const key = `${r.group}|${r.outcome}`;
  counts[key] = (counts[key] || 0) + 1;
});
console.log("Row counts:", counts);
console.log("Total:", rows.length);

fs.writeFileSync(path.join(__dirname, 'smallpox.json'), JSON.stringify(data, null, 2));
console.log("Written smallpox.json successfully");
