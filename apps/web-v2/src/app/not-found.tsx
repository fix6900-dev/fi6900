import Link from "next/link";

/** 404: the level slot shows 404.00 in the giant style. */
export default function NotFound() {
  return (
    <div className="page">
      <div className="hero">
        <div className="quote-band micro">
          <span>Page not found · not in the index</span>
          <span>Error 404</span>
        </div>
        <div className="level" style={{ ["--glyphs" as string]: 6 }} role="img" aria-label="404.00">
          {"404.00".split("").map((g, i) =>
            /\d/.test(g) ? (
              <span key={i} className="od" aria-hidden>
                <span className="od-d">{g}</span>
              </span>
            ) : (
              <span key={i} className="od-p" aria-hidden>
                {g}
              </span>
            ),
          )}
        </div>
        <p className="lede">There is no page at this address. The pages in the index are below.</p>
        <div className="cta" style={{ marginTop: "var(--space-5)" }}>
          <Link href="/" className="btn btn-primary btn-lg">
            Index
          </Link>
          <Link href="/verify" className="btn btn-secondary btn-lg">
            Verify
          </Link>
          <Link href="/methodology" className="btn btn-secondary btn-lg">
            Methodology
          </Link>
        </div>
      </div>
    </div>
  );
}
