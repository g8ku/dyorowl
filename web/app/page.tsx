import { Owl } from "@/components/Owl";

const X_URL = "https://x.com/dyorowl";

/** Decorative evidence stamps behind the hero. Positions are percentages of the hero. */
const STAMPS = [
  { text: "RUGGED", left: "4%", top: "10%", rotate: -9, size: 1 },
  { text: "DEV DUMPED", left: "46%", top: "82%", rotate: 7, size: 0.8 },
  { text: "BUNDLED", left: "48%", top: "6%", rotate: -4, size: 0.7 },
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="sky" aria-hidden="true">
          <span className="moon" />
          {STAMPS.map((s) => (
            <span
              key={s.text}
              className="stamp"
              style={{ left: s.left, top: s.top, transform: `rotate(${s.rotate}deg)`, fontSize: `${s.size}em` }}
            >
              {s.text}
            </span>
          ))}
        </div>

        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">Case file 001</p>
            <h1>
              Every coin
              <br />
              is a case.
            </h1>
            <p className="lede">An AI detective owl that investigates memecoins. Comics that teach you to do it yourself.</p>
            <p className="soon">Coming soon...</p>
            <a className="cta" href={X_URL} target="_blank" rel="noopener noreferrer">
              Follow @dyorowl for the first case
            </a>
          </div>
          <Owl className="hero-owl" />
        </div>
      </section>

      <section className="files" aria-labelledby="files-heading">
        <h2 id="files-heading">What the owl is working on</h2>
        <div className="file-grid">
          <article className="file">
            <p className="file-tab">Exhibit A</p>
            <h3>Case files</h3>
            <p>
              Tag the owl with a contract address and get a case file back: who holds the supply, what the dev wallet
              is doing, how deep the liquidity is, and a Hoot score out of 100.
            </p>
          </article>
          <article className="file">
            <p className="file-tab">Exhibit B</p>
            <h3>Owl Academy</h3>
            <p>
              One comic, one lesson. Reading bonding curves, spotting fake volume, knowing when to take profit. So next
              time you can crack the case yourself.
            </p>
          </article>
        </div>
      </section>

      <footer className="footer">
        <p>Not financial advice. Memecoins are high risk. Always do your own research.</p>
        <p>© {new Date().getFullYear()} DYOR Owl</p>
      </footer>
    </main>
  );
}

