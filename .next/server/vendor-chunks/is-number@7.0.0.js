"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/is-number@7.0.0";
exports.ids = ["vendor-chunks/is-number@7.0.0"];
exports.modules = {

/***/ "(rsc)/./node_modules/.pnpm/is-number@7.0.0/node_modules/is-number/index.js":
/*!****************************************************************************!*\
  !*** ./node_modules/.pnpm/is-number@7.0.0/node_modules/is-number/index.js ***!
  \****************************************************************************/
/***/ ((module) => {

eval("/*!\n * is-number <https://github.com/jonschlinkert/is-number>\n *\n * Copyright (c) 2014-present, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n\n\nmodule.exports = function(num) {\n  if (typeof num === 'number') {\n    return num - num === 0;\n  }\n  if (typeof num === 'string' && num.trim() !== '') {\n    return Number.isFinite ? Number.isFinite(+num) : isFinite(+num);\n  }\n  return false;\n};\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9ub2RlX21vZHVsZXMvLnBucG0vaXMtbnVtYmVyQDcuMC4wL25vZGVfbW9kdWxlcy9pcy1udW1iZXIvaW5kZXguanMiLCJtYXBwaW5ncyI6IkFBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVhOztBQUViO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsInNvdXJjZXMiOlsid2VicGFjazovL3N0b3J5dGVsbGluZy8uL25vZGVfbW9kdWxlcy8ucG5wbS9pcy1udW1iZXJANy4wLjAvbm9kZV9tb2R1bGVzL2lzLW51bWJlci9pbmRleC5qcz9iMDNmIl0sInNvdXJjZXNDb250ZW50IjpbIi8qIVxuICogaXMtbnVtYmVyIDxodHRwczovL2dpdGh1Yi5jb20vam9uc2NobGlua2VydC9pcy1udW1iZXI+XG4gKlxuICogQ29weXJpZ2h0IChjKSAyMDE0LXByZXNlbnQsIEpvbiBTY2hsaW5rZXJ0LlxuICogUmVsZWFzZWQgdW5kZXIgdGhlIE1JVCBMaWNlbnNlLlxuICovXG5cbid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihudW0pIHtcbiAgaWYgKHR5cGVvZiBudW0gPT09ICdudW1iZXInKSB7XG4gICAgcmV0dXJuIG51bSAtIG51bSA9PT0gMDtcbiAgfVxuICBpZiAodHlwZW9mIG51bSA9PT0gJ3N0cmluZycgJiYgbnVtLnRyaW0oKSAhPT0gJycpIHtcbiAgICByZXR1cm4gTnVtYmVyLmlzRmluaXRlID8gTnVtYmVyLmlzRmluaXRlKCtudW0pIDogaXNGaW5pdGUoK251bSk7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufTtcbiJdLCJuYW1lcyI6W10sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(rsc)/./node_modules/.pnpm/is-number@7.0.0/node_modules/is-number/index.js\n");

/***/ })

};
;