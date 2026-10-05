import { FlywheelSection } from "@/components/home/FlywheelSection";
import { Hero } from "@/components/home/Hero";
import { Holdings } from "@/components/home/Holdings";
import { HowItWorks } from "@/components/home/HowItWorks";
import { Performance } from "@/components/home/Performance";
import { Portfolio } from "@/components/home/Portfolio";
import { VerifyStrip } from "@/components/home/VerifyStrip";

export default function HomePage() {
  return (
    <div className="page home">
      <Hero />
      <Portfolio n={1} />
      <Holdings />
      <Performance />
      <HowItWorks />
      <FlywheelSection />
      <VerifyStrip />
    </div>
  );
}
