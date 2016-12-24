/*\
title: $:/plugins/cyrius/tiddler-roc/tiddler-toc-macro.js
type: application/javascript
module-type: macro

Insert tiddler ToC at macro position, allowing to also override the default min-entries parameter.
\*/
(function(){

"use strict";


exports.name = "tiddler-toc";

exports.params = [
  {name: "min-entries"}
];

exports.run = function(minEntries) {
  var parent = this.parentDomNode;
  if (!parent.isTiddlyWikiFakeDom) {
    parent["toc-on"] = true;
    var r = "<div class='tw_ttoc' style='display:none;'";
    if (minEntries > 0) r += " min-entries='" + minEntries + "'";
    r += " />";
    return r;
  } else {
    return undefined;
  }
};

})();
