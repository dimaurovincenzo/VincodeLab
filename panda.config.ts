import { defineConfig } from '@pandacss/dev'
import { graphiteGlobalCss } from './src/theme/global-css'
import { buttonRecipe, checkboxRecipe, collapsibleRecipe, comboboxRecipe, dialogRecipe, editableRecipe, fieldRecipe, fileUploadRecipe, listboxRecipe, popoverRecipe, progressRecipe, segmentGroupRecipe, selectRecipe, spinnerRecipe, splitterRecipe, tabsRecipe, toastRecipe, tooltipRecipe, treeViewRecipe } from './src/theme/recipes'
import { graphiteCssVariables, graphiteKeyframes, graphiteSemanticTokens, graphiteTokens, themeConditions } from './src/theme/tokens'

export default defineConfig({
  preflight: true,
  jsxFramework: 'react',
  include: ['./src/**/*.{js,jsx,ts,tsx}'],
  exclude: [],
  outdir: 'styled-system',
  conditions: { extend: themeConditions },
  globalCss: graphiteGlobalCss,
  globalVars: graphiteCssVariables,
  theme: {
    extend: {
      tokens: graphiteTokens,
      semanticTokens: graphiteSemanticTokens,
      keyframes: graphiteKeyframes,
      recipes: { button: buttonRecipe, spinner: spinnerRecipe },
      slotRecipes: {
        checkbox: checkboxRecipe,
        collapsible: collapsibleRecipe,
        combobox: comboboxRecipe,
        dialog: dialogRecipe,
        editable: editableRecipe,
        field: fieldRecipe,
        fileUpload: fileUploadRecipe,
        listbox: listboxRecipe,
        popover: popoverRecipe,
        progress: progressRecipe,
        segmentGroup: segmentGroupRecipe,
        select: selectRecipe,
        splitter: splitterRecipe,
        tabs: tabsRecipe,
        toast: toastRecipe,
        tooltip: tooltipRecipe,
        treeView: treeViewRecipe,
      },
    },
  },
})
