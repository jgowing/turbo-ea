import { lazy, Suspense } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";

const ComplianceScanner = lazy(() => import("./ComplianceScanner"));

/**
 * GRC > Compliance tab.
 *
 * Thin lazy-load wrapper around the compliance register. AI-provider
 * gating is **scoped** — only the scan-trigger card inside the scanner
 * is hidden when no AI provider is configured. Overview, register grid,
 * and manual-finding entry all work regardless, because they read
 * existing findings from the DB.
 */
export default function ComplianceTab() {
  return (
    <Suspense
      fallback={
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      }
    >
      <ComplianceScanner />
    </Suspense>
  );
}
