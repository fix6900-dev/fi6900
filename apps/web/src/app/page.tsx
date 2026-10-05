import { FlywheelSection } from "@/components/home/FlywheelSection";
import { Hero } from "@/components/home/Hero";
import { HoldingsTable } from "@/components/home/HoldingsTable";
import { HowItWorks } from "@/components/home/HowItWorks";
import { NavChart } from "@/components/home/NavChart";
import { StatStrip } from "@/components/home/StatStrip";
import { VerifyStrip } from "@/components/home/VerifyStrip";
import { SectionHeader } from "@/components/ui/Card";

export default function HomePage() {
  return (
    <>
      <Hero />
      <StatStrip />
      <section id="holdings" className="wrap section scroll-mt-14">
        <SectionHeader eyebrow="Holdings" title="Live vault composition" desc="Actual weight against target, drift from target, and the on-chain vault for every constituent." />
        <HoldingsTable />
      </section>
      <section className="wrap section pt-0">
        <SectionHeader eyebrow="NAV" title="NAV against market price" desc="When the market price drifts from NAV, arbitrage brings it back. Markers show divisor resets at auction fills." />
        <NavChart />
      </section>
      <HowItWorks />
      <FlywheelSection />
      <VerifyStrip />
    </>
  );
}
