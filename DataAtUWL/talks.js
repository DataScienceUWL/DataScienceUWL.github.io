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
     kind      - optional label for what sort of talk this is, e.g. "Research",
                 "Industry", "Careers", "Methods", "Student work". Shown as a
                 chip beside the talk. Omit it and nothing is shown.
     org       - the speaker's affiliation. For a UWL speaker this is just
                 "UW-La Crosse · Mathematics & Statistics".
     tags      - optional, 2-4 short topic chips.
     links     - optional extra buttons (registration, org site, recording).
   ========================================================================== */

const SERIES = {
  name: "Data @ UWL",
  tagline: "What people actually do with data.",
  blurb:
    "A talk series on statistics and data science at UW–La Crosse — research, methods, real-world applications, and the careers built on them. Speakers come from industry, from other campuses, and from our own faculty and students. Three to four talks each semester, free and open to all UWL students.",
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
    kind: "Industry",
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
     Talks are not only about careers. A faculty or student research talk, a
     methods talk, or a walk through an applied project all belong here --
     the example below is shaped like a research talk.

  {
    id: "2026-10-22-example",
    number: 2,
    term: "Fall 2026",
    title: "Talk title goes here",
    speakers: "First Last",
    org: "UW-La Crosse · Mathematics & Statistics",
    kind: "Research",
    start: "2026-10-22T16:00",
    end: "2026-10-22T17:00",
    location: "Centennial Hall 1404",
    abstract: "One or two paragraphs, roughly 60-95 words. Say what the
      question is, what the data looks like, and why a student should care --
      not just the result.",
    poster: null,
    tags: ["Medical imaging", "Deep learning"],
    links: [{ label: "Project page", url: "https://example.org" }],
  },
  ---------------------------------------------------------------------- */
];
