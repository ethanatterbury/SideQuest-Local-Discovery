import Link from "next/link";
export const metadata = { title: "Good to know" };
export default function About() {
  return (
    <article className="page-container about-page">
      <h1>Good to know.</h1>
      <p className="lead">A useful little nudge to get you somewhere good.</p>
      <h2>Your data stays with you.</h2>
      <p>
        Saved places, collections, reactions, notes and afternoons are stored in
        this browser. There’s no account and no cloud sync. Clearing browser
        data removes your library. Precise location coordinates are used in
        memory for nearby recommendations; we don’t save movement traces.
      </p>
      <h2>A recommendation, with a reason.</h2>
      <p>
        SideQuest weighs travel, time, budget, conditions, company, novelty and
        your explicit reactions. It is a deterministic recommendation tool, with
        no generative AI claims, purchased ratings or fake crowd information.
      </p>
      <h2>A little uncertainty is honest.</h2>
      <p>
        Journeys are rounded estimates derived from distance and typical speed,
        including a road-distance allowance. They are not traffic or
        road-routing information. Visit duration is editorial guidance. Opening
        times, parking, prices and access need checking on each place’s official
        website. Free entry can still involve parking or optional activities.
      </p>
      <h2>Weather, when it’s available.</h2>
      <p>
        Forecasts come from{" "}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>
        . Forecasts can change. If the service is unavailable, discovery
        continues and we tell you. Daylight falls back to conservative
        approximate hours; check local conditions. Recommendations are a
        starting point, not an assurance of safety or availability.
      </p>
      <h2>The first patch of the world.</h2>
      <p>
        Our curated launch places are in Surrey, Berkshire and Hampshire. You
        can start elsewhere, but we won’t invent local coverage. Place
        descriptions are SideQuest editorial copy, with links to the official
        sources. Photographs come from Wikimedia Commons under their stated
        licences, with credits on place pages. Other places use intentional
        typographic artwork.
      </p>
      <h2>A little app in your pocket.</h2>
      <p>
        Add SideQuest to your home screen from your browser menu. On iPhone, use
        Share → Add to Home Screen. Previously loaded pages and your local
        library remain available when the connection disappears.
      </p>
      <Link className="button" href="/">
        Find your next good idea
      </Link>
    </article>
  );
}
