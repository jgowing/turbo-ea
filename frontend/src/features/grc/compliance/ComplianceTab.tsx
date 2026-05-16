import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useAuthContext } from "@/hooks/AuthContext";
import { useAiStatus } from "@/hooks/useAiStatus";
import { SEVERITY_COLORS } from "@/theme/tokens";

const ComplianceScanner = lazy(() => import("./ComplianceScanner"));

/**
 * GRC > Compliance tab.
 *
 * Compliance scanning (EU AI Act, GDPR, NIS2, DORA, SOC 2, ISO 27001) calls
 * the configured LLM per regulation. Without an AI provider every scan returns
 * "AI is not configured" placeholders, and the tab UI is misleading — so when
 * AI isn't configured we surface a clear gate instead of the scanner. Admins
 * get a deep link to the AI settings; non-admins are told who to ask.
 */
export default function ComplianceTab() {
  const { t } = useTranslation("grc");
  const { aiStatus, aiStatusLoaded } = useAiStatus();
  const { user } = useAuthContext();

  if (!aiStatusLoaded) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!aiStatus.configured) {
    const canConfigure =
      !!user?.permissions?.["*"] || !!user?.permissions?.["admin.settings"];
    return (
      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 5 }, maxWidth: 720, mx: "auto", mt: 2 }}>
        <Stack spacing={2.5} alignItems="flex-start">
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <MaterialSymbol icon="psychology_alt" size={32} color={SEVERITY_COLORS.high} />
            <Typography variant="h6" fontWeight={600}>
              {t("compliance.aiRequired.title")}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {t("compliance.aiRequired.body")}
          </Typography>
          <Typography variant="caption" color="text.disabled">
            {t("compliance.aiRequired.regulations")}
          </Typography>
          {canConfigure ? (
            <Button
              variant="contained"
              startIcon={<MaterialSymbol icon="settings" size={18} />}
              component={RouterLink}
              to="/admin/settings?tab=ai"
            >
              {t("compliance.aiRequired.configureCta")}
            </Button>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
              {t("compliance.aiRequired.contactAdmin")}
            </Typography>
          )}
        </Stack>
      </Paper>
    );
  }

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
