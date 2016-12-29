/*\
title: $:/plugins/cyrius/ga-tracker/ga-tracker.js
type: application/javascript
module-type: startup

Google Analytics tracking on tiddlers.
\*/
(function(){

// Export name and synchronous status
exports.name = "ga-tracker";
exports.platforms = ["browser"];
exports.synchronous = true;

// (legacy) Google Analytics ga.js
var VERSION_GA = 0;
// (new) Universal Analytics analytics.js
var VERSION_UA = 1;

// Tracking actions as events.
var TRACKING_TYPE_EVENTS = 0;
// Tracking actions as page views.
var TRACKING_TYPE_PAGES = 1;

// Event "Open" value: tiddler open in story.
var EVENT_OPEN_STORY = 2;
// Event "Open" value: tiddler open as target (parmalink/permaview).
var EVENT_OPEN_STARTUP_TARGET = 1;
// Event "Open" value: tiddler open from permaview, but not as target.
var EVENT_OPEN_STARTUP = 0;

// The temporary 'state' tiddler. Used to visually dispay whether tracking is on or off.
var TEMP_GA_TRACKER_STATE_TIDDLER = "$:/temp/ga-tracker/state";

// Note: we store settings in a dedicated tiddler fields.
// We could use a data tiddler (JSON type), but it is not really worth it:
//  - some form widgets does not handle it yet (e.g. checkbox before v5.1.14)
//  - most widgets work with text, and could not properly handle other types (boolean, integer) of data
var CONFIG_GA_TRACKER_SETTINGS_TIDDLER = "$:/config/ga-tracker/settings";
var CONFIG_GA_TRACKER_SETTINGS_DEFAULT = {
  enabled: 1,
  version: VERSION_UA,
  id: "",
  url_exclude: "",
  type: TRACKING_TYPE_EVENTS,
  events_dnt: 1,
  events_open: 1,
  events_refresh: 1,
  events_edit: 1,
  events_close: 0,
  events_search: 0,
  search_min_size: 2,
  search_delay: 1000,
  title_filter: "",
  honor_dnt: 1,
  testing_enabled: 0,
  testing_mock: 0
};

var trackSettings = CONFIG_GA_TRACKER_SETTINGS_DEFAULT;

var searched = undefined;
var searchDelayTimer = undefined;

// Map of overriden TiddlyWiki core functions.
var overriden = {};

var NavigatorWidget = require("$:/core/modules/widgets/navigator.js").navigator;

exports.startup = function() {
  loadSettings();

  if (trackSettings.state.gat_on) installTracker();
  else console.log("GA tracker off");
};

// Transforms a boolean to integer value.
function intBoolean(v) {
  return v ? 1 : 0;
}

// Sets fiels to a given tiddler.
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

// Get a field value from a tiddler fields.
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

function isDoNotTrack(v) {
  return (v !== undefined) && ((v == "1") || (v == "yes"));
}

// Loads the plugin settings.
function loadSettings() {
  var tiddler = $tw.wiki.getTiddler(CONFIG_GA_TRACKER_SETTINGS_TIDDLER);
  var fields = tiddler ? tiddler.fields : {};

  trackSettings = {
    enabled: getIntField(fields, "gat_enabled", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.enabled),
    version: getIntField(fields, "gat_version", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.version),
    id: getStringField(fields, "gat_id", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.id),
    url_exclude: getStringField(fields, "gat_url_exclude", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.url_exclude),
    honor_dnt: getIntField(fields, "gat_honor_dnt", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.honor_dnt),
    type: getIntField(fields, "gat_type", TRACKING_TYPE_EVENTS, CONFIG_GA_TRACKER_SETTINGS_DEFAULT.type),
    events_dnt: getIntField(fields, "gat_events_dnt", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.events_dnt),
    events_open: getIntField(fields, "gat_events_open", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.events_open),
    events_refresh: getIntField(fields, "gat_events_refresh", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.events_refresh),
    events_edit: getIntField(fields, "gat_events_edit", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.events_edit),
    events_close: getIntField(fields, "gat_events_close", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.events_close),
    events_search: getIntField(fields, "gat_events_search", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.events_search),
    search_min_size: getIntField(fields, "gat_search_min_size", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.events_search_min_size),
    search_delay: getIntField(fields, "gat_search_delay", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.events_search_delay),
    title_filter: getStringField(fields, "gat_title_filter", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.title_filter),
    testing_enabled: getIntField(fields, "gat_testing_enabled", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.testing_enabled),
    testing_mock: getIntField(fields, "gat_testing_mock", CONFIG_GA_TRACKER_SETTINGS_DEFAULT.testing_mock)
  };
  // Save default values if necessary
  // EditTextWidget does not cope for missing fields if tiddler exists: https://github.com/Jermolene/TiddlyWiki5/issues/2680
  setFields(CONFIG_GA_TRACKER_SETTINGS_TIDDLER, trackSettings, "gat_", true);
  if (trackSettings.title_filter) trackSettings.title_filter = new RegExp(trackSettings.title_filter);

  // Only track in non-local mode.
  // Note: anyway the browser does not appear to load online scripts when accessing local file.
  var local = "file:" == document.location.protocol;
  var url_excluded = trackSettings.url_exclude ? (new RegExp(trackSettings.url_exclude, "i")).test(document.location.href) : 0;
  var do_not_track = isDoNotTrack(navigator.doNotTrack) || isDoNotTrack(window.doNotTrack) || isDoNotTrack(navigator.msDoNotTrack);
  var state = {
    gat_enabled: intBoolean(trackSettings.enabled),
    gat_id_defined: intBoolean(trackSettings.id),
    gat_online: intBoolean(!local),
    gat_url_allowed: intBoolean(!url_excluded),
    gat_can_track: !do_not_track ? 1 : (trackSettings.honor_dnt ? 0 : -1),
    gat_script_loaded: 0,
    gat_plugged: intBoolean(!trackSettings.testing_mock) || -1
  }
  state.gat_on = state.gat_enabled && state.gat_id_defined
    && state.gat_online && state.gat_url_allowed
    && (state.gat_can_track || trackSettings.events_dnt);
  state.gat_track_actions = state.gat_on && state.gat_can_track;
  trackSettings.state = state;
  updatedState();

  if (trackSettings.testing_enabled) console.log("GA tracker settings", trackSettings);

  return trackSettings;
}

// Updates the current state of the plugin (to display in the plugin tiddler).
function updatedState() {
  trackSettings.state.gat_working = intBoolean(trackSettings.state.gat_on && trackSettings.state.gat_script_loaded);
  if (trackSettings.state.gat_working && ((trackSettings.state.gat_plugged <= 0) || !trackSettings.state.gat_track_actions)) trackSettings.state.gat_working = -1;
  setFields(TEMP_GA_TRACKER_STATE_TIDDLER, trackSettings.state);
}

// Installs the tracker.
function installTracker() {
  console.log("GA tracker on");

  if (trackSettings.version == VERSION_UA) {
    // GoogleAnalytics object. Needs to be global.
    window["GoogleAnalyticsObject"] = "ga";
    if (!window.ga) {
      window.ga = function() {
        window.ga.q.push(arguments);
      };
      window.ga.q = [];
      window.ga.l = 1 * new Date();
    }
  } else {
    // Google Analytics queue object. Needs to be global.
    window._gaq = window._gaq || [];
  }

  // Initialize tracking.
  track("create", trackSettings.id, "auto");
  if (trackSettings.events_dnt && (trackSettings.state.gat_can_track <= 0)) track("send", "event", "DoNotTrack");
  if (trackSettings.state.gat_track_actions) {
    track("send", "pageview");
    trackStartup();
  }

  // Insert script tag to load GA.
  var gaNode = document.createElement("script");
  if (trackSettings.version == VERSION_GA) gaNode.type = "text/javascript";
  gaNode.async = (trackSettings.version == VERSION_UA) ? 1 : true;
  if (trackSettings.version == VERSION_UA) gaNode.src = "//www.google-analytics.com/analytics.js";
  else gaNode.src = ("https:" == document.location.protocol ? "https://ssl" : "http://www") + ".google-analytics.com/ga.js";
  gaNode.onload = function() {
    console.log("GA script loaded");
    trackSettings.state.gat_script_loaded = 1;
    updatedState();
  };
  document.body.appendChild(gaNode);

  // Override the necessary TiddlyWiki core functions.
  if (trackSettings.state.gat_track_actions) {
    if (trackSettings.events_open || trackSettings.events_refresh) {
      overriden["navigator.addToStory"] = NavigatorWidget.prototype.addToStory;
      NavigatorWidget.prototype.addToStory = trackAndAddToStory;
    }
    if (trackSettings.events_edit) {
      overriden["navigator.handleEditTiddlerEvent"] = NavigatorWidget.prototype.handleEditTiddlerEvent;
      NavigatorWidget.prototype.handleEditTiddlerEvent = trackAndEditTiddler;
    }
    if ((trackSettings.type == TRACKING_TYPE_EVENTS) && trackSettings.events_close) {
      overriden["navigator.handleCloseTiddlerEvent"] = NavigatorWidget.prototype.handleCloseTiddlerEvent;
      NavigatorWidget.prototype.handleCloseTiddlerEvent = trackAndCloseTiddler;
      overriden["navigator.handleCloseAllTiddlersEvent"] = NavigatorWidget.prototype.handleCloseAllTiddlersEvent;
      NavigatorWidget.prototype.handleCloseAllTiddlersEvent = trackAndCloseAllTiddlers;
      overriden["navigator.handleCloseOtherTiddlersEvent"] = NavigatorWidget.prototype.handleCloseOtherTiddlersEvent;
      NavigatorWidget.prototype.handleCloseOtherTiddlersEvent = trackAndCloseOtherTiddlers;
    }
    if ((trackSettings.type == TRACKING_TYPE_EVENTS) && trackSettings.events_search) {
      overriden["wiki.search"] = $tw.wiki.search;
      $tw.wiki.search = trackAndSearch;
    }
  }
}

// Generates the actual tracking notification.
function track(action, param) {
  // See: https://developers.google.com/analytics/devguides/collection/upgrade/reference/gajs-analyticsjs
  // (["_setAccount", id]) => ("create", id, "auto")
  // (["_trackPageview", opt_path]) => ("send", "pageview", opt_path)
  // (["_trackEvent", category, action, opt_label, opt_value)] => ("send", "event", category, action, opt_label, opt_value)
  if (trackSettings.version == VERSION_UA) {
    if (trackSettings.testing_enabled) console.log("Track", Array.prototype.slice.call(arguments));
    // We have to push the arguments
    if (!trackSettings.testing_mock) ga.apply(ga, arguments);
  } else {
    var params;
    switch (action) {
      case "create":
        params = ["_setAccount", param];
        break;

      case "send":
        if (param == "pageview") {
          params = ["_trackPageview"];
          for (var i=2; i<arguments.length; i++) params.push(arguments[i]);
        } else if (param == "event") {
          params = ["_trackEvent"];
          for (var i=2; i<arguments.length; i++) params.push(arguments[i]);
        }
        break;
    }
    if (!params) params = arguments;
    if (trackSettings.testing_enabled) console.log("Track", params);
    // We have to push an array containing the arguments
    if (!trackSettings.testing_mock) _gaq.push(params);
  }
}

// Checks tracking is allowed for a given tiddler title.
function testTitle(title) {
  return !trackSettings.title_filter || trackSettings.title_filter.test(title);
}

// Checks startup tiddlers (permalink/permaview) to trigger "Open" actions if necessary.
function trackStartup() {
  // "Open" action notified if title is not excluded and tiddler exists.
  function startupTiddler(title, value) {
    if (testTitle(title) && $tw.wiki.getTiddler(title)) trackOpenTiddler(title, "Open", value);
  }

  if (trackSettings.events_open && ($tw.locationHash.length > 1)) {
    var hash = $tw.locationHash.substr(1);
    var split = hash.indexOf(":");
    if(split === -1) {
      var target = decodeURIComponent(hash.trim());
      startupTiddler(target, EVENT_OPEN_STARTUP_TARGET);
    } else {
      var target = decodeURIComponent(hash.substr(0,split).trim());
      var storyFilter = decodeURIComponent(hash.substr(split + 1).trim());
      var storyList = $tw.wiki.filterTiddlers(storyFilter);

      // First process the targeted tiddler, then the other viewed tiddlers.
      startupTiddler(target, EVENT_OPEN_STARTUP_TARGET);
      for (var i=0; i<storyList.length; i++) {
        var title = storyList[i];
        if (title !== target) startupTiddler(title, EVENT_OPEN_STARTUP);
      }
    }
  }
}

function trackOpenTiddler(title, trackEvent, trackValue) {
  // Note: for real URIs, we should 'encodeURI' the title.
  if (trackSettings.type == TRACKING_TYPE_PAGES) track("send", "pageview", "/#" + title);
  else track("send", "event", "Tiddlers", trackEvent, title, trackValue);
}

// Overrides tiddler opening/refreshing action.
function trackAndAddToStory(title, fromTitle) {
  if ((trackSettings.events_open || trackSettings.events_refresh) && testTitle(title)) {
    var storyList = this.getStoryList();
    var slot = storyList ? storyList.indexOf(title) : -1;
    var trackEvent = (slot < 0)
      ? (trackSettings.events_open ? "Open" : undefined)
      : (trackSettings.events_refresh ? "Refresh" : undefined)
      ;
    var trackValue = (slot < 0) ? EVENT_OPEN_STORY : undefined;
    if (trackEvent) trackOpenTiddler(title, trackEvent, trackValue);
  }
  return overriden["navigator.addToStory"].apply(this, arguments);
}

// Overrides tiddler editing action.
function trackAndEditTiddler(event) {
  if (trackSettings.events_edit) {
    var title = event.param || event.tiddlerTitle;
    if (testTitle(title)) {
      if (trackSettings.type == TRACKING_TYPE_PAGES) track("send", "pageview", "/#" + title);
      else track("send", "event", "Tiddlers", "Edit", title);
    }
  }
  return overriden["navigator.handleEditTiddlerEvent"].apply(this, arguments);
}

// Overrides tiddler closing action.
function trackAndCloseTiddler(event) {
  if ((trackSettings.type == TRACKING_TYPE_EVENTS) && trackSettings.events_close) {
    var title = event.param || event.tiddlerTitle;
    if (testTitle(title)) track("send", "event", "Tiddlers", "Close", title);
  }
  return overriden["navigator.handleCloseTiddlerEvent"].apply(this, arguments);
}

// Overrides tiddlers 'close all' action.
function trackAndCloseAllTiddlers(event) {
  if ((trackSettings.type == TRACKING_TYPE_EVENTS) && trackSettings.events_close) {
    var storyList = this.getStoryList();
    var closed = storyList ? storyList.length : 0;
    if (closed > 0) track("send", "event", "Tiddlers", "CloseAll", undefined, closed);
  }
  return overriden["navigator.handleCloseAllTiddlersEvent"].apply(this, arguments);
}

// Overrides tiddlers 'close other' action.
function trackAndCloseOtherTiddlers(event) {
  if ((trackSettings.type == TRACKING_TYPE_EVENTS) && trackSettings.events_close) {
    var title = event.param || event.tiddlerTitle;
    var storyList = this.getStoryList();
    var closed = storyList ? storyList.length - 1: 0;
    if (closed > 0) track("send", "event", "Tiddlers", "CloseAll", title, closed);
  }
  return overriden["navigator.handleCloseOtherTiddlersEvent"].apply(this, arguments);
}

// Overrides searching action.
function trackAndSearch(text) {
  if ((trackSettings.type == TRACKING_TYPE_EVENTS) && trackSettings.events_search && (text !== searched)) {
    searched = text;
    // Searching is triggered each time the value is changed.
    // So wait for the value to remain the same during a given time before actually taking it into account.
    // http://stackoverflow.com/a/7849308
    clearTimeout(searchDelayTimer);
    if (text.length >= trackSettings.search_min_size) {
      searchDelayTimer = setTimeout(function() {
        track("send", "event", "Tiddlers", "Search", text);
      }, trackSettings.search_delay);
    }
  }
  return overriden["wiki.search"].apply($tw.wiki, arguments);
}

})();
