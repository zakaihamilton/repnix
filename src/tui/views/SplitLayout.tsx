import { Box } from "ink";
import type React from "react";

export function SplitLayout({
  horizontal,
  showSidebar,
  sidebar,
  showDetails,
  details,
}: {
  horizontal: boolean;
  showSidebar: boolean;
  sidebar: React.ReactElement;
  showDetails: boolean;
  details: React.ReactElement;
}): React.ReactElement {
  return (
    <Box
      flexDirection={horizontal ? "row" : "column"}
      gap={horizontal ? 1 : 0}
      flexGrow={1}
      minHeight={1}
      overflow="hidden"
    >
      {showSidebar ? sidebar : null}
      {showDetails ? details : null}
    </Box>
  );
}
