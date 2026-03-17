#!/usr/bin/env python3
"""Add metadata fields to county JSON files. Run once, then delete this script."""
import json, os

files_config = {
    'county_income.json': {
        'studyDescription': "Median household income for over 3,000 US counties based on American Community Survey (ACS) estimates. Each observation represents one county's estimated median household income. This is a census of all US counties, not a sample.",
        'variableDescriptions': {
            'median_hh_income': 'Estimated median household income for the county in US dollars'
        },
        'sourceDetail': 'OpenIntro IMS Ch. 2. Data from the openintro R package (county). Original data from the U.S. Census Bureau American Community Survey.'
    },
    'county_pop.json': {
        'studyDescription': "Population estimates for over 3,000 US counties in 2017, from the U.S. Census Bureau. Each observation represents one county's estimated total population. This is a census of all US counties, not a sample.",
        'variableDescriptions': {
            'pop2017': 'Estimated total population of the county in 2017'
        },
        'sourceDetail': 'OpenIntro IMS Ch. 2. Data from the openintro R package (county). Original data from the U.S. Census Bureau population estimates program.'
    }
}

script_dir = os.path.dirname(os.path.abspath(__file__))

for filename, meta in files_config.items():
    filepath = os.path.join(script_dir, filename)
    with open(filepath, 'r') as f:
        d = json.load(f)

    new_d = {}
    for k in d:
        if k == 'context':
            new_d['studyDescription'] = meta['studyDescription']
            new_d['variableDescriptions'] = meta['variableDescriptions']
            new_d['sourceDetail'] = meta['sourceDetail']
        new_d[k] = d[k]

    with open(filepath, 'w') as f:
        json.dump(new_d, f, separators=(',', ':'))

    print(f'Updated {filename}')

print('Done. You can delete this script now.')
