/*\
title: $:/plugins/cyrius/tiddler-toc/tiddler-toc.js
type: application/javascript
module-type: widget

Redefines some internal rendering code to build a Table of Contents inside tiddlers.
\*/
(function(){

"use strict";

var hTag = /^h([1-6])$/i;

var CONFIG_TIDDLER_TOC_SETTINGS_TIDDLER = "$:/config/tiddler-toc/settings";
var CONFIG_TIDDLER_TOC_SETTINGS_DEFAULT = {
  min_entries: 2,
  title_filter: "^(?!\\$:)"
}

var tocSettings = CONFIG_TIDDLER_TOC_SETTINGS_DEFAULT;
loadSettings();


// 'transclude' is used for standard tiddlers and transclusion.
// 'reveal' is used for tiddlers embedded through tabs macro.
var RevealWidget = require("$:/core/modules/widgets/reveal.js").reveal;
var TiddlerWidget = require("$:/core/modules/widgets/tiddler.js").tiddler;
var TranscludeWidget = require("$:/core/modules/widgets/transclude.js").transclude;

// Backup current rendering functions before redefining them
var overriden = {
  "reveal.render": RevealWidget.prototype.render,
  "transclude.render": TranscludeWidget.prototype.render
};

RevealWidget.prototype.render = function(parent, nextSibling) {
  overriden["reveal.render"].call(this, parent, nextSibling);
  buildToC(getWidgetNode(this));
}

TranscludeWidget.prototype.render = function(parent, nextSibling) {
  overriden["transclude.render"].call(this, parent, nextSibling);
  buildToC(getWidgetNode(this));
}


// Sets fields to a given tiddler.
function setFields(title, fields, fieldPrefix, ifChanged) {
  if (fieldPrefix) {
    var newFields = {};
    $tw.utils.each(fields, function(value, key) {
      newFields[fieldPrefix + key] = value;
    });
    fields = newFields;
  }

  var tiddler = $tw.wiki.getTiddler(title);
  var doSave = !ifChanged || (!tiddler && fields);
  if (!doSave) {
    for (var field in fields) {
      if (tiddler.fields[field] != fields[field]) {
        doSave = true;
        break;
      }
    }
  }
  if (doSave) {
    var fallbackFields = {title: title};
    $tw.wiki.addTiddler(new $tw.Tiddler($tw.wiki.getCreationFields(), fallbackFields, tiddler, fields, $tw.wiki.getModificationFields()));
  }
}

// Gets a field value from a tiddler fields.
function getField(fields, field, def) {
  return (fields[field] !== undefined) ? fields[field] : def;
}

// Gets a field as string value. Empty value is returned as undefined.
function getStringField(fields, field, def) {
  var r = getField(fields, field, undefined);
  if (r && !r.length) r = undefined;
  return r ? r : def;
}

// Gets a field as int value.
function getIntField(fields, field, def) {
  return parseInt(getField(fields, field, def));
}

// Loads the plugin settings.
function loadSettings() {
  var tiddler = $tw.wiki.getTiddler(CONFIG_TIDDLER_TOC_SETTINGS_TIDDLER);
  var fields = tiddler ? tiddler.fields : {};

  tocSettings = {
    min_entries: getIntField(fields, "ttoc_min_entries", CONFIG_TIDDLER_TOC_SETTINGS_DEFAULT.min_entries),
    title_filter: getStringField(fields, "ttoc_title_filter", CONFIG_TIDDLER_TOC_SETTINGS_DEFAULT.title_filter)
  };
  // Save default values if necessary
  // EditTextWidget does not cope for missing fields if tiddler exists: https://github.com/Jermolene/TiddlyWiki5/issues/2680
  setFields(CONFIG_TIDDLER_TOC_SETTINGS_TIDDLER, tocSettings, "ttoc_", true);
  if (tocSettings.title_filter) tocSettings.title_filter = new RegExp(tocSettings.title_filter);

  return tocSettings;
}

function isTiddlerBody(node) {
  return node && $tw.utils.hasClass(node, "tc-tiddler-body");
}

function isTabContent(node, widget) {
  return node && $tw.utils.hasClass(node, "tc-tab-content") && (!widget || widget.isOpen);
}

function isTcReveal(node) {
  return node && $tw.utils.hasClass(node, "tc-reveal");
}

// Gets the node for which to generate the ToC, if any.
function getWidgetNode(widget) {
  var tiddlerTitle = widget.getVariable("currentTiddler");
  // We only care for tiddlers with title. (empty title happens in sidebar)
  if ((typeof tiddlerTitle !== "string") || (tiddlerTitle == "")) return undefined;

  var node = widget.parentDomNode;
  // We need a real parent DOM node to work with. It is expected to be a "div" or "p" element.
  if (!node || node.isTiddlyWikiFakeDom || ((node.tagName != "DIV") && (node.tagName != "P"))) return undefined;

  var isTocOn = node["toc-on"];
  var isBody = isTiddlerBody(node);
  var isTab = isTabContent(node, widget);
  // The node needs to be the tiddler body (standard tiddler and transclusion), or an opened tab content
  if (!isBody && !isTab) {
    // Special case for plugin tiddlers.
    if (isTcReveal(node.parentElement) && isTabContent(node.parentElement.parentElement)) {
      node = node.parentElement.parentElement;
      isTab = true;
    } else {
      return undefined;
    }
  }

  // Nothing to do if ToC was already done.
  if (node["toc-done"]) return undefined;

  // We exclude transcluded tiddlers (parent widget is a tiddler), as parent tiddler will take care of building the ToC.
  if (TiddlerWidget.prototype.isPrototypeOf(widget.parentWidget)) return undefined;

  // We allow when explicitly asked for.
  if (isTocOn) return node;

  // Or we finally exclude tiddlers on title name.
  if (!tocSettings.title_filter.test(tiddlerTitle) || (isTab && !tocSettings.title_filter.test(widget.text))) return undefined;

  return node;
}

// Get the actual node in which to generate the ToC.
function getBody(node, isTcReveal) {
  // It must have the "tc-reveal" class (or be a child of an element that has it) and have children.
  // As a special case for special tiddlers, we also check there is more than one child or that it is not a "p" or "div" element:
  //  - plugin tiddlers have a wrapper "p" child
  //  - some processed tiddlers (e.g. by TWC parser) have a wrapper "div" child
  if (!node) return node;
  isTcReveal |= $tw.utils.hasClass(node, "tc-reveal");
  if (isTcReveal && node.firstElementChild &&
    ((node.children.length != 1) || ((node.firstElementChild.tagName != "P") && (node.firstElementChild.tagName != "DIV")))) return node;
  if (!node.firstElementChild) return undefined;
  // There is currently no need to search for children other than the first when the parent does not match.
  return getBody(node.firstElementChild, isTcReveal);
}

// Get the headings to reference in the ToC.
function getHeadings(node) {
  // We only search in top-level elements.
  var nodes = [];
  for (var i=0; i<node.children.length; i++) {
    var child = node.children[i];
    if (hTag.test(child.tagName)) nodes.push(child);
  }
  return nodes;
}

// Gets the next ToC entry id.
function getNextHeadingId(id) {
  // Provided an entry 'id' (e.g. 1.2.1), determine its next sibling one (e.g. 1.2.2).
  // We thus split, increment the last number, and re-join.
  id = id.split(".");
  id[id.length - 1]++;
  return id.join(".");
}

// Creates a new link "a" element.
function buildLink(text, styleClass) {
  var link = document.createElement("a");
  $tw.utils.addClass(link, "tc-tiddlylink");
  if (styleClass !== undefined) $tw.utils.addClass(link, styleClass);
  link.setAttribute("href", "javascript:;");
  link.appendChild(document.createTextNode(text));
  return link;
}

// Builds the ToC entry for a given heading.
function buildToCEntry(heading) {
  // The 'entry id' element
  var entryId = buildLink(heading["toc-headingId"], "tw_ttoc_id");
  // Scroll to heading when clicked
  entryId.onclick = function() {
    window.scrollTo(0, getOffset(heading).top);
  };

  // The entry (contains id and title)
  var entry = document.createElement("div");
  $tw.utils.addClass(entry, "tw_ttoc_entry");
  var clonedHeading = cloneNodeWithEvents(heading);
  entry.appendChild(entryId);
  // We now want to copy the heading content into our entry (next to its id).
  // See: http://stackoverflow.com/a/11580409
  entry.appendChild(clonedHeading);
  clonedHeading.outerHTML = clonedHeading.innerHTML;

  return entry;
}

// Builds a new sub-level 'block' to contain sub-entries.
function newHeadingsLevel(headingsLevel) {
  var newLevel = document.createElement("div");
  $tw.utils.addClass(newLevel, "tw_ttoc_level");
  if (headingsLevel.lastChild) headingsLevel.lastChild.appendChild(newLevel);
  else headingsLevel.appendChild(newLevel);
  return newLevel;
}

// Finds the ToC location if any (macro used).
function findToC(node) {
  // The macro generated a "div" element with "tw_ttoc" class, which was inserted inside a "p" element by TiddlyWiki.
  var children = node.getElementsByTagName("P");
  for (var i=0; i<children.length; i++) {
    var child = children[i];
    if (!child.firstElementChild) continue;
    node = child.firstElementChild;
    if ((node.tagName == "DIV") && $tw.utils.hasClass(node, "tw_ttoc")) return node;
  }
  return undefined;
}

// Builds the actual ToC, if applicable.
function buildToC(node) {
  // Nothing to do if we don't know where to generate the ToC, or if it was already done.
  node = getBody(node);
  if ((node === undefined) || node["toc-done"]) return;
  node["toc-done"] = true;

  var isTocOn = node["toc-on"];
  // Determine where to generate the ToC (first element by default), and start to build it.
  var toc = (isTocOn && findToC(node)) || document.createElement("div");
  var tocMinEntries = toc.getAttribute("min-entries") || tocSettings.min_entries;
  $tw.utils.addClass(toc, "tw_ttoc");
  var tocTitle = document.createElement("div");
  $tw.utils.addClass(tocTitle, "tw_ttoc_title");
  var tocTitleLink = buildLink("Table of Contents");
  tocTitleLink.setAttribute("title", "Hide/Show Table of Contents");
  // Hide/Show ToC when title clicked
  var tocContent = document.createElement("div");
  $tw.utils.addClass(tocContent, "tw_ttoc_entries");
  tocTitleLink.onclick = function() {
    if (tocContent.style.display === "none") tocContent.style.display = "block";
    else tocContent.style.display = "none";
  };
  tocTitle.appendChild(tocTitleLink);
  toc.appendChild(tocTitle);
  toc.appendChild(tocContent);

  // Check there are enough entries to display the ToC.
  var headings = getHeadings(node);
  if (headings.length < tocMinEntries) {
    // Remove the ToC tag if necessary (macro used).
    if (toc.parentElement) toc.parentElement.removeChild(toc);
    return;
  }
  // Show the ToC if necessary (macro used).
  if (toc.style.display === "none") toc.style.display = "block";

  // Determine which levels of heading are used. Useful to generate sensible ToC entry ids.
  var levelsUsed = [];
  for (var i=0; i<=6; i++) levelsUsed[i] = 0;
  for (var i=0; i<headings.length; i++) {
    var heading = headings[i];
    var headingLevel = parseInt(hTag.exec(heading.tagName)[1]);
    levelsUsed[headingLevel] += 1;
    heading["toc-headingLevel"] = headingLevel;
  }

  // Then generate the entries corresponding to the headings.
  var headingsLevel = tocContent;
  var currentLevel;
  for (currentLevel=1; levelsUsed[currentLevel]==0; currentLevel++);
  // Initial entry 'id' (will be incremented for each new entry, and derived for sub-entries).
  var currentHeadingId = "0";
  // Special case where the first heading is actually a sub-level (e.g. "h2" as first heading, then "h1").
  if (headings[0]["toc-headingLevel"] != currentLevel) currentHeadingId = "1";
  for (var i=0; i<headings.length; i++) {
    var heading = headings[i];
    var headingLevel = heading["toc-headingLevel"];
    var headingId = currentHeadingId;

    // determine this heading index
    if (headingLevel < currentLevel) {
      // have to go up
      while (headingLevel <= --currentLevel) {
        if (levelsUsed[currentLevel] > 0) {
          // Go to the parent 'level' node, or the 'entries' one (top-level).
          // Usually is 'parentNode.parentNode' (because the parent should be
          // a ToC entry). But sometimes (levels skipped, like h1 -> h3 -> h2)
          // the parent already is the upper level.
          headingsLevel = headingsLevel.parentNode;
          while (!$tw.utils.hasClass(headingsLevel, "tw_ttoc_level") && !$tw.utils.hasClass(headingsLevel, "tw_ttoc_entries")) {
            headingsLevel = headingsLevel.parentNode;
          }
          headingId = headingId.split(".");
          headingId.pop();
          headingId = headingId.join(".");
        }
      }
      headingId = getNextHeadingId(headingId);
    }
    else if (headingLevel > currentLevel) {
      // have to go down
      while (headingLevel >= ++currentLevel) {
        if (levelsUsed[currentLevel] > 0) {
          headingsLevel = newHeadingsLevel(headingsLevel);
          headingId = headingId.split(".");
          headingId.push("1");
          headingId = headingId.join(".");
        }
      }
    } else {
      // same level (i.e. sibling)
      headingId = getNextHeadingId(headingId);
    }
    heading["toc-headingId"] = headingId;

    var entry = buildToCEntry(heading);
    headingsLevel.appendChild(entry);

    // Insert a 'ToC' link in the heading
    var tocTop = document.createElement("span");
    $tw.utils.addClass(tocTop, "tw_ttoc_top");
    var tocTopLink = buildLink("[ToC]");
    tocTopLink.setAttribute("title", "Go to Table of Contents");
    tocTopLink.onclick = function() {
      window.scrollTo(0, getOffset(toc).top);
    };
    tocTop.appendChild(tocTopLink);
    heading.appendChild(tocTop);

    currentLevel = headingLevel;
    currentHeadingId = headingId;
  }

  // Insert the built ToC if necessary.
  if (!toc.parentElement) {
    // Insert a "br" element to separate ToC from the first child if it is not a "br", "p", or heading element.
    // (e.g. text node or "a" link)
    var sibling = node.firstChild;
    if ((sibling !== node.firstElementChild) || ((sibling.tagName !== "BR") && (sibling.tagName !== "DIV") && !hTag.test(sibling.tagName))) {
      node.insertBefore(document.createElement("br"), node.firstChild);
    }
    node.insertBefore(toc, node.firstChild);
  }
}

function cloneNodeWithEvents(node) {
  var clone = node.cloneNode(true);
  var n1 = [node].concat(Array.prototype.slice.call(node.getElementsByTagName("*")));
  var n2 = [clone].concat(Array.prototype.slice.call(clone.getElementsByTagName("*")));

  for (var i=0; i<n1.length; i++) {
    for (var j in n1[i]) {
      if (j.substr(0,2) != "on") continue;
      n2[i][j] = n1[i][j];
    }
  }

  return clone;
}

// Find element position.
// See: http://javascript.info/tutorial/coordinates
// See: http://stackoverflow.com/q/442404
function getOffset(elem) {
  if (elem.getBoundingClientRect) {
    return getOffsetRect(elem)
  } else {
    return getOffsetSum(elem)
  }
}

function getOffsetRect(elem) {
  var box = elem.getBoundingClientRect();

  var body = document.body;
  var docElem = document.documentElement;

  var scrollTop = window.pageYOffset || docElem.scrollTop || body.scrollTop;
  var scrollLeft = window.pageXOffset || docElem.scrollLeft || body.scrollLeft;

  var clientTop = docElem.clientTop || body.clientTop || 0;
  var clientLeft = docElem.clientLeft || body.clientLeft || 0;

  var top  = box.top +  scrollTop - clientTop;
  var left = box.left + scrollLeft - clientLeft;

  return { top: Math.round(top), left: Math.round(left) };
}

function getOffsetSum(elem) {
  var top=0, left=0;

  while(elem) {
    top = top + parseInt(elem.offsetTop);
    left = left + parseInt(elem.offsetLeft);
    elem = elem.offsetParent;
  }
   
  return {top: top, left: left};
}

})();
