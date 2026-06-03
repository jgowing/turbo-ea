import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

/**
 * Discrete data-quality importance control. Four tiers, shown as a slider with
 * numeric marks plus the tier name + number, so admins see both the friendly
 * label and the exact weight:
 *   Ignore = 0, Normal = 1, Important = 2, Critical = 3.
 *
 * The underlying value is the numeric field/contributor `weight` (0 excludes).
 * Dragging updates a local value for smooth feedback; the parent `onChange`
 * (which persists + refreshes) only fires on release, so the screen does not
 * flicker mid-drag. Legacy/out-of-range weights snap to the nearest tier.
 */

export const TIER_KEYS = ["ignore", "normal", "important", "critical"] as const;
export type Tier = 0 | 1 | 2 | 3;

export function weightToTier(weight: number | undefined): Tier {
  const w = weight ?? 1;
  if (w <= 0) return 0;
  if (w < 2) return 1;
  if (w < 3) return 2;
  return 3;
}

/** Intensity ramp (grey → primary.dark) so stronger weight reads as "counts more". */
export function useTierColor(): (tier: Tier) => string {
  const theme = useTheme();
  return (tier: Tier) =>
    [
      theme.palette.action.disabled,
      theme.palette.primary.light,
      theme.palette.primary.main,
      theme.palette.primary.dark,
    ][tier];
}

interface ImportanceSliderProps {
  value: number | undefined;
  onChange: (weight: number) => void;
}

export default function ImportanceSlider({ value, onChange }: ImportanceSliderProps) {
  const { t } = useTranslation("admin");
  const tierColor = useTierColor();

  // Local tier mirrors the prop but updates instantly while dragging.
  const [tier, setTier] = useState<Tier>(weightToTier(value));
  useEffect(() => {
    setTier(weightToTier(value));
  }, [value]);

  const color = tierColor(tier);
  const tierLabel = t(`metamodel.importance.${TIER_KEYS[tier]}`);

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, width: "100%" }}>
      <Slider
        value={tier}
        onChange={(_, v) => setTier(Number(v) as Tier)}
        onChangeCommitted={(_, v) => onChange(Number(v))}
        min={0}
        max={3}
        step={1}
        marks={[{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }]}
        size="small"
        valueLabelDisplay="off"
        aria-label={t("metamodel.importance.label")}
        sx={{
          flex: 1,
          color,
          py: 1,
          "& .MuiSlider-rail": { height: 6, opacity: 0.3 },
          "& .MuiSlider-track": { height: 6, border: "none" },
          "& .MuiSlider-thumb": { width: 16, height: 16 },
          "& .MuiSlider-mark": { height: 6, width: 2, bgcolor: "currentColor", opacity: 0.4 },
          "& .MuiSlider-markActive": { bgcolor: "currentColor", opacity: 1 },
        }}
      />
      <Typography
        variant="caption"
        sx={{ color, fontWeight: 700, width: 92, flexShrink: 0, textAlign: "right", whiteSpace: "nowrap" }}
      >
        {tierLabel} ({tier})
      </Typography>
    </Box>
  );
}
