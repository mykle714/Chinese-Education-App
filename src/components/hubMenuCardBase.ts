// Shared base style for every hub card — full-width HubMenuRows, HubMenuArrayItem
// sub-cards, and feature strips that build their own cards (e.g. Word Search's
// hub item). Kept in its own module (not HubMenu.tsx) so exporting this non-
// component value doesn't disable React Fast Refresh for the component file.
//
// Callers layer width/flex + backgroundColor on top, and may override
// aspectRatio (e.g. the 1:1 Word Search resume card). See docs/HUB_MENU_SYSTEM.md.
export const cardBaseSx = {
    position: "relative" as const,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    aspectRatio: "2 / 1",
    padding: "20px",
    borderRadius: "28px",
    textDecoration: "none",
    color: "inherit",
    transition: "transform 120ms ease, filter 120ms ease",
    "&:hover": {
        filter: "brightness(0.97)",
    },
    "&:active": {
        transform: "scale(0.98)",
    },
};
