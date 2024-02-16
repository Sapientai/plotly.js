import constants from './util/constants.js';
import _bundle from './util/bundle_wrapper.mjs';

/*
 * Trimmed down version of ./bundle.js for CI testing
 *
 * Outputs:
 *
 *  - plotly.js bundle in build/
 *  - plotly-geo-assets.js bundle in build/ (in accordance with test/image/index.html)
 *  - plotly.min.js bundle in build/ (for minified_bundle test)
 */

// Bundle plotly.js and plotly.min.js
_bundle(constants.pathToPlotlyIndex, constants.pathToPlotlyBuild, {
    noCompress: true,
    pathToMinBundle: constants.pathToPlotlyBuildMin
}, function() {
    // Bundle the geo assets
    _bundle(constants.pathToPlotlyGeoAssetsSrc, constants.pathToPlotlyGeoAssetsDist, {
        noCompress: true,
        standalone: 'PlotlyGeoAssets'
    });
});
