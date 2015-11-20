/*
 * Copyright (c) 2011 Vinay Pulim <vinay@milewise.com>
 * MIT Licensed
 */

'use strict';

var url = require('url');
var req = require('request');
var debug = require('debug')('node-soap');

var VERSION = require('../package.json').version;

/**
 * A class representing the http client
 * @param {Object} [options] Options object. It allows the customization of
 * `request` module
 *
 * @constructor
 */
function HttpClient(options) {
  options = options || {};
  this._request = options.request || req;
}

/**
 * Build the HTTP request (method, uri, headers, ...)
 * @param {String} rurl The resource url
 * @param {Object|String} data The payload
 * @param {Object} exheaders Extra http headers
 * @param {Object} exoptions Extra options
 * @returns {Object} The http request object for the `request` module
 */
HttpClient.prototype.buildRequest = function(rurl, data, exheaders, exoptions) {
  var curl = url.parse(rurl);
  var secure = curl.protocol === 'https:';
  var host = curl.hostname;
  var port = parseInt(curl.port, 10);
  var path = [curl.pathname || '/', curl.search || '', curl.hash || ''].join('');
  var method = data ? 'POST' : 'GET';
  var headers = {
    'User-Agent': 'node-soap/' + VERSION,
    'Accept': 'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
    'Accept-Encoding': 'none',
    'Accept-Charset': 'utf-8',
    'Connection': 'close',
    'Host': host + (isNaN(port) ? '' : ':' + port)
  };
  var attr;

  if (typeof data === 'string') {
    headers['Content-Length'] = Buffer.byteLength(data, 'utf8');
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  exheaders = exheaders || {};
  for (attr in exheaders) {
    headers[attr] = exheaders[attr];
  }

  var options = {
    uri: curl,
    method: method,
    headers: headers,
    followAllRedirects: true
  };

  if (headers.Connection === 'keep-alive') {
    options.body = data;
  }

  exoptions = exoptions || {};
  for (attr in exoptions) {
    options[attr] = exoptions[attr];
  }
  debug('Http request: %j', options);
  return options;
};

/**
 * Handle the http response
 * @param {Object} The req object
 * @param {Object} res The res object
 * @param {Object} body The http body
 * @param {Object} The parsed body
 */
HttpClient.prototype.handleResponse = function(req, res, body) {
  debug('Http response body: %j', body);
  
  if (typeof body === 'string') {
    // Handle binaries
    this.handleBinaries(res, body);
    // Remove any extra characters that appear before or after the SOAP
    // envelope.
    var match = body.match(/(?:<\?[^?]*\?>[\s]*)?<([^:]*):Envelope([\S\s]*)<\/\1:Envelope>/i);
    if (match) {
      body = match[0];
    }
  }
  return body;
};

/**
 * Handle SOAP/MTOM attached binaries and populates them in the http response
 * @param {Object} res The response object
 * @param {Object} body The http body
 */
HttpClient.prototype.handleBinaries = function(res, body) {
  var bou_regex = /(?:boundary=)([\w-]*)(?:;)/i;
  var binaries = {};
  var contains_binaries = false;
  var boundary = bou_regex.exec( res.headers['content-type'] );
  
  if (boundary && boundary.length > 0) {
    boundary = boundary[1];
    
    var inc_regex = /(?:<xop\:Include href="cid\:)([\w@\.-]*)(?:"><\/xop\:Include>)/gi;
    var match = inc_regex.exec(body);
    
    if (match && match.length > 0) {
      contains_binaries = true;
      
      for (var i = 1, len = match.length; i < len; i++) {
        var id = match[i];
        
        binaries[id] = {
          mime: null,
          data: null
        };
      }
    }
  }
  
  if (contains_binaries) {
    var bodyParts = body.split(boundary);
    var id_regex = /^(?:Content-Id: <)([\w\/\.@-]*)(?:>)$/m;
    var mim_regex = /^(?:Content-Type: )([\w\/+-]*)$/m;
    
    for (var i = 1, len = bodyParts.length; i < len; i++) {
      var part = bodyParts[i];
      var binId = id_regex.exec(part);
      
      if (binId && binId.length > 0) {
        binId = binId[1];
         
        var aux = mim_regex.exec(part);
        
        if (aux && aux.length > 0) {
          binaries[binId].mime = aux[1];
        }
        
        aux = part.indexOf('\r\n') != -1 ? part.split('\r\n') : part.split('\n');
        
        if (aux && aux.length > 0) {
          binaries[binId].data = aux[4] == '' ? aux[5] : aux[4];
        }
      }
    }
  }
  
  res['binaries'] = binaries;
};

HttpClient.prototype.request = function(rurl, data, callback, exheaders, exoptions) {
  var self = this;
  var options = self.buildRequest(rurl, data, exheaders, exoptions);
  var headers = options.headers;
  var req = self._request(options, function(err, res, body) {
    if (err) {
      return callback(err);
    }
    body = self.handleResponse(req, res, body);
    callback(null, res, body);
  });
  if (headers.Connection !== 'keep-alive') {
    req.end(data);
  }
  return req;
};

module.exports = HttpClient;
