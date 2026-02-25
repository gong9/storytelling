/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/queue-microtask@1.2.3";
exports.ids = ["vendor-chunks/queue-microtask@1.2.3"];
exports.modules = {

/***/ "(rsc)/./node_modules/.pnpm/queue-microtask@1.2.3/node_modules/queue-microtask/index.js":
/*!****************************************************************************************!*\
  !*** ./node_modules/.pnpm/queue-microtask@1.2.3/node_modules/queue-microtask/index.js ***!
  \****************************************************************************************/
/***/ ((module) => {

eval("/*! queue-microtask. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */\nlet promise\n\nmodule.exports = typeof queueMicrotask === 'function'\n  ? queueMicrotask.bind(typeof window !== 'undefined' ? window : global)\n  // reuse resolved promise, and allocate it lazily\n  : cb => (promise || (promise = Promise.resolve()))\n    .then(cb)\n    .catch(err => setTimeout(() => { throw err }, 0))\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9ub2RlX21vZHVsZXMvLnBucG0vcXVldWUtbWljcm90YXNrQDEuMi4zL25vZGVfbW9kdWxlcy9xdWV1ZS1taWNyb3Rhc2svaW5kZXguanMiLCJtYXBwaW5ncyI6IkFBQUE7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EscUNBQXFDLFdBQVciLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly9zdG9yeXRlbGxpbmcvLi9ub2RlX21vZHVsZXMvLnBucG0vcXVldWUtbWljcm90YXNrQDEuMi4zL25vZGVfbW9kdWxlcy9xdWV1ZS1taWNyb3Rhc2svaW5kZXguanM/YWQxYyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKiEgcXVldWUtbWljcm90YXNrLiBNSVQgTGljZW5zZS4gRmVyb3NzIEFib3VraGFkaWplaCA8aHR0cHM6Ly9mZXJvc3Mub3JnL29wZW5zb3VyY2U+ICovXG5sZXQgcHJvbWlzZVxuXG5tb2R1bGUuZXhwb3J0cyA9IHR5cGVvZiBxdWV1ZU1pY3JvdGFzayA9PT0gJ2Z1bmN0aW9uJ1xuICA/IHF1ZXVlTWljcm90YXNrLmJpbmQodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgPyB3aW5kb3cgOiBnbG9iYWwpXG4gIC8vIHJldXNlIHJlc29sdmVkIHByb21pc2UsIGFuZCBhbGxvY2F0ZSBpdCBsYXppbHlcbiAgOiBjYiA9PiAocHJvbWlzZSB8fCAocHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpKSlcbiAgICAudGhlbihjYilcbiAgICAuY2F0Y2goZXJyID0+IHNldFRpbWVvdXQoKCkgPT4geyB0aHJvdyBlcnIgfSwgMCkpXG4iXSwibmFtZXMiOltdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(rsc)/./node_modules/.pnpm/queue-microtask@1.2.3/node_modules/queue-microtask/index.js\n");

/***/ })

};
;