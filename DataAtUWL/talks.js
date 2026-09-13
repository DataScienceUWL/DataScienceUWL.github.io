/* ==========================================================================
   Data @ UWL — talk data
   --------------------------------------------------------------------------
   THIS IS THE ONLY FILE YOU NEED TO EDIT TO ADD A TALK.

   Add a new object to the TALKS array below, drop the poster SVG/PDF into
   posters/, commit, push. The site sorts by date automatically and features
   the next upcoming talk (or the most recent one, once the semester ends).

   Field notes:
     id        - short slug; becomes the permalink (#/2026-09-17-hedgehog).
                 Use this in Canvas announcements. Never change it once shared.
     start/end - local time, "YYYY-MM-DDTHH:MM". No timezone suffix.
     abstract  - plain text. Blank line = new paragraph.
     poster    - path to the poster file, or null if there isn't one yet.
     tags      - optional, 2-4 short topic chips.
     links     - optional extra buttons (registration, org site, recording).
   ========================================================================== */

const SERIES = {
  name: "Data @ UWL",
  tagline: "Data people. Real work. Serious curiosity.",
  blurb:
    "A recurring conversation between UWL students and the people who use data to make consequential decisions. Three to four talks each semester, free and open to all UWL students.",
  department: "Mathematics & Statistics Department",
  institution: "University of Wisconsin–La Crosse",
  contact: "jbaggett@uwlax.edu",
};

const TALKS = [
  {
    id: "2026-09-17-hedgehog",
    number: 1,
    term: "Fall 2026",
    title: "Quills, Thrills & Power Bills: Hertz the Power Hedgehog",
    speakers: "David Elzinga & Claire Nordt",
    org: "Dairyland Power Cooperative",
    start: "2026-09-17T16:00",
    end: "2026-09-17T17:00",
    location: "Centennial Hall 1404",
    abstract:
      "Dairyland Power Cooperative is a generation and transmission cooperative that supplies wholesale electricity to member cooperatives serving approximately 800,000 people across Wisconsin, Minnesota, Iowa, and Illinois.\n\nIn this talk, we'll introduce Dairyland, explore how quantitative tools support our day-to-day work, and provide a high-level look at Hedgehog, one of our pricing models. We'll also highlight three paid internship opportunities currently open at Dairyland.",
    poster: "posters/2026-09-17_hedgehog.svg",
    tags: ["Energy markets", "Pricing models", "Paid internships"],
    links: [],
  },

  /* ---- Copy this block for the next talk -------------------------------
  {
    id: "2026-10-22-example",
    number: 2,
    term: "Fall 2026",
    title: "Talk title goes here",
    speakers: "First Last",
    org: "Organization",
    start: "2026-10-22T16:00",
    end: "2026-10-22T17:00",
    location: "Centennial Hall 1404",
    abstract: "One or two paragraphs, roughly 60-95 words.",
    poster: null,
    tags: [],
    links: [{ label: "Speaker's site", url: "https://example.org" }],
  },
  ---------------------------------------------------------------------- */
];
