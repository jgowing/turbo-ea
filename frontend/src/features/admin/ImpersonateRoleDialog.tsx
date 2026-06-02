import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import { api, setToken, auth } from "@/api/client";
import type { AppRole } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

export default function ImpersonateRoleDialog({ open, onClose, onSuccess }: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<AppRole[]>("/roles");
      // Exclude the admin role itself (no value in impersonating a wildcard
      // role, and the backend rejects it anyway) and any archived role.
      const eligible = data.filter((r) => r.key !== "admin" && !r.is_archived);
      setRoles(eligible);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) {
      fetchRoles();
      setSelected("");
      setError(null);
    }
  }, [open, fetchRoles]);

  const handleConfirm = useCallback(async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const { access_token } = await auth.impersonate(selected);
      setToken(access_token);
      await onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }, [selected, onSuccess, onClose, t]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("admin:impersonation.dialog.title")}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {t("admin:impersonation.dialog.body")}
        </DialogContentText>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <FormControl fullWidth>
            <InputLabel id="impersonate-role-label">
              {t("admin:impersonation.dialog.roleLabel")}
            </InputLabel>
            <Select
              labelId="impersonate-role-label"
              label={t("admin:impersonation.dialog.roleLabel")}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={submitting}
            >
              {roles.map((r) => (
                <MenuItem key={r.key} value={r.key}>
                  {r.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={!selected || submitting || loading}
        >
          {submitting ? (
            <CircularProgress size={18} />
          ) : (
            t("admin:impersonation.dialog.confirm")
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
