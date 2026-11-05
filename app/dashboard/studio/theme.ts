// AG Studio theme for ChamaPot. Studio's theme params are mapped onto the ChamaPot brand tokens
// (docs/CONTRACTS.md): cream page, white cards with warm hairlines, pot green as the accent,
// marigold for highlights and clay for anything late. Values are literal colours rather than CSS
// variables so popups and context menus (rendered outside the dashboard's DOM) match too; the fonts
// are the --font-display / --font-sans variables that app/layout.tsx sets on <html>.

import { studioTheme } from 'ag-studio';

export const BRAND = {
  ink: '#12261F',
  pot: '#0E7C66',
  potDeep: '#0A5A4A',
  potSoft: '#E3F1EC',
  marigold: '#F2A93B',
  marigoldSoft: '#FDF1DC',
  clay: '#C2410C',
  claySoft: '#FBE9E1',
  cream: '#FBF7F0',
  card: '#FFFFFF',
  line: '#E6DED0',
  lineSoft: '#F0EADF',
  muted: '#5E6B66',
  success: '#15803D',
  danger: '#B91C1C',
} as const;

export const DISPLAY_FONT = 'var(--font-display), Fraunces, Georgia, serif';
export const SANS_FONT = 'var(--font-sans), Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

// Chart series: pot green and marigold lead, then warm earth tones that stay distinct in print.
const CHART_PALETTE = [
  BRAND.pot,
  BRAND.marigold,
  BRAND.clay,
  '#2F6F8F',
  '#8A5A9E',
  BRAND.potDeep,
  '#D9822B',
  '#5E8C31',
  '#B4534A',
  '#7A8B85',
];

const palette = Object.fromEntries(
  CHART_PALETTE.flatMap((color, i) => [
    [`chartPaletteFills${i + 1}Color`, color],
    [`chartPaletteStrokes${i + 1}Color`, color],
  ]),
);

const line = (color: string) => ({ width: 1, color });

export const chamaStudioTheme = studioTheme.withParams({
  // Shared by Studio's UI, grids and charts.
  fontFamily: SANS_FONT,
  fontSize: 14,
  textColor: BRAND.ink,
  foregroundColor: BRAND.ink,
  subtleTextColor: BRAND.muted,
  backgroundColor: BRAND.card,
  borderColor: BRAND.line,
  accentColor: BRAND.pot,
  iconColor: BRAND.potDeep,
  rowHoverColor: BRAND.potSoft,
  borderRadius: 10,
  menuBackgroundColor: BRAND.card,
  menuTextColor: BRAND.ink,
  menuSeparatorColor: BRAND.line,
  tooltipBackgroundColor: BRAND.ink,
  tooltipTextColor: '#FFFFFF',
  toggleButtonOnBackgroundColor: BRAND.pot,

  // Mobile: let Studio shrink to a phone. The page's own min width is lowered in the layout prop,
  // and a single-column breakpoint takes over below 500px (see dashboard.tsx).
  studioMinWidth: 0,
  studioMinHeight: 0,

  // No frame: the canvas is the cream page itself and widgets are the cards on it.
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: BRAND.cream,
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: BRAND.cream,
  studioCanvasPadding: 16,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: SANS_FONT,

  // Widgets: white cards, warm hairline, 14px radius, a whisper of shadow.
  studioWidgetBackgroundColor: BRAND.card,
  studioWidgetBorder: line(BRAND.line),
  studioWidgetBorderRadius: 14,
  studioWidgetShadow: '0 1px 2px rgba(18, 38, 31, 0.04), 0 4px 14px rgba(18, 38, 31, 0.04)',
  studioWidgetPadding: 12,
  studioWidgetTitleFontFamily: DISPLAY_FONT,
  studioWidgetTitleFontSize: 17,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: BRAND.ink,
  studioWidgetSubtitleFontFamily: SANS_FONT,
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: BRAND.muted,
  studioWidgetCaptionFontFamily: SANS_FONT,
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: BRAND.muted,
  studioWidgetResizeBorderColor: BRAND.pot,
  studioWidgetSelectedBorderColor: BRAND.pot,
  studioValueWidgetFontSize: 28,

  // Edit-mode panels read as part of the sidebar.
  studioPanelContainerBackgroundColor: BRAND.card,
  studioPanelContainerBorder: line(BRAND.line),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: BRAND.line,
  studioPanelDividerActiveColor: BRAND.pot,
  studioPanelSectionBorderColor: BRAND.line,
  studioPanelHeaderFontFamily: DISPLAY_FONT,
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: BRAND.potSoft,
  studioPanelChevronButtonHoverColor: BRAND.potDeep,
  studioToggleButtonActiveBackgroundColor: BRAND.potSoft,
  studioToggleButtonActiveBorderColor: BRAND.pot,
  studioToggleButtonActiveColor: BRAND.potDeep,
  studioFiltersPanelCardSubtleColor: BRAND.muted,
  studioAiPanelRichTextAccentBackgroundColor: BRAND.marigoldSoft,
  studioAiPanelInputMessageBackgroundColor: BRAND.potSoft,

  // Popups (member statements, drill-through) match the cards.
  studioPopupBackgroundColor: BRAND.card,
  studioPopupBorderRadius: 14,
  studioPopupTitleBarBackgroundColor: BRAND.cream,
  studioPopupTitleBarTextColor: BRAND.ink,
  studioPopupTitleBarFontFamily: DISPLAY_FONT,
  studioPopupTitleBarFontWeight: 600,

  // Live Data: a value that rises flashes pot green, one that falls flashes clay, on a marigold wash.
  valueChangeUpColor: BRAND.success,
  valueChangeDownColor: BRAND.clay,
  valueChangeHighlightBackgroundColor: BRAND.marigoldSoft,

  // Grid widgets: muted semibold headers, warm dividers, roomy rows.
  gridFontFamily: SANS_FONT,
  gridFontSize: 14,
  gridCellTextColor: BRAND.ink,
  gridHeaderBackgroundColor: BRAND.card,
  gridHeaderTextColor: BRAND.muted,
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 13,
  gridRowHeight: 40,
  gridRowBorder: line(BRAND.lineSoft),
  gridHeaderRowBorder: line(BRAND.line),
  gridPinnedRowBorder: line(BRAND.line),
  gridRowHoverColor: BRAND.cream,
  gridAccentColor: BRAND.pot,
  gridWrapperBorder: false,

  // Charts.
  chartFontFamily: SANS_FONT,
  chartTextColor: BRAND.ink,
  chartSubtleTextColor: BRAND.muted,
  chartAxisLineColor: BRAND.line,
  chartGridLineColor: BRAND.lineSoft,
  chartTooltipBackgroundColor: BRAND.card,
  chartTooltipTextColor: BRAND.ink,
  chartTooltipBorder: line(BRAND.line),
  ...palette,
});
