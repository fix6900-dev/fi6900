"use client";

import { Portfolio } from "../home/Portfolio";
import { PageHeader } from "../ui/Card";

export function PortfolioView() {
  return (
    <div className="page pagebody">
      <PageHeader eyebrow="Portfolio" title="Your share of the vault." desc="Units are a pro-rata claim on every constituent. This page reads your FIX6900 Index balance from your wallet and prices it at the latest NAV snapshot." />
      <Portfolio standalone />
    </div>
  );
}
