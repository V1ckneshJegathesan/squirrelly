// TODO: allow '-' to trim up until newline. Use [^\S\n\r] instead of \s
// TODO: only include trimLeft polyfill if not in ES6
/* END TYPES */
var promiseImpl = new Function('return this;')().Promise;
function hasOwnProp(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
}
function copyProps(toObj, fromObj, notConfig) {
    for (var key in fromObj) {
        if (hasOwnProp(fromObj, key)) {
            if (fromObj[key] != null &&
                typeof fromObj[key] == 'object' &&
                (key === 'storage' || key === 'plugins') &&
                !notConfig // not called from Cache.load
            ) {
                // plugins or storage
                // Note: this doesn't merge from initial config!
                // Deep clone instead of assigning
                // TODO: run checks on this
                toObj[key] = copyProps(/*toObj[key] ||*/ {}, fromObj[key]);
            }
            else {
                toObj[key] = fromObj[key];
            }
        }
    }
    return toObj;
}
function trimWS(str, env, wsLeft, wsRight) {
    var leftTrim;
    var rightTrim;
    if (typeof env.autoTrim === 'string') {
        leftTrim = rightTrim = env.autoTrim;
    }
    else if (Array.isArray(env.autoTrim)) {
        // kinda confusing
        // but _}} will trim the left side of the following string
        leftTrim = env.autoTrim[1];
        rightTrim = env.autoTrim[0];
    }
    if (wsLeft) {
        leftTrim = wsLeft;
    }
    if (wsRight) {
        rightTrim = wsRight;
    }
    if ((leftTrim === 'slurp' && rightTrim === 'slurp') ||
        (leftTrim === true && rightTrim === true)) {
        return str.trim();
    }
    if (leftTrim === '_' || leftTrim === 'slurp' || leftTrim === true) {
        // console.log('trimming left' + leftTrim)
        // full slurp
        if (String.prototype.trimLeft) {
            str = str.trimLeft();
        }
        else {
            str = str.replace(/^[\s\uFEFF\xA0]+/, '');
        }
    }
    else if (leftTrim === '-' || leftTrim === 'nl') {
        // console.log('trimming left nl' + leftTrim)
        // nl trim
        str = str.replace(/^(?:\n|\r|\r\n)/, '');
    }
    if (rightTrim === '_' || rightTrim === 'slurp' || rightTrim === true) {
        // console.log('trimming right' + rightTrim)
        // full slurp
        if (String.prototype.trimRight) {
            str = str.trimRight();
        }
        else {
            str = str.replace(/[\s\uFEFF\xA0]+$/, '');
        }
    }
    else if (rightTrim === '-' || rightTrim === 'nl') {
        // console.log('trimming right nl' + rightTrim)
        // nl trim
        str = str.replace(/(?:\n|\r|\r\n)$/, ''); // TODO: make sure this gets \r\n
    }
    return str;
}

/* END TYPES */
var Cacher = /** @class */ (function () {
    function Cacher(cache) {
        this.cache = cache;
    }
    Cacher.prototype.define = function (key, val) {
        this.cache[key] = val;
    };
    Cacher.prototype.get = function (key) {
        // string | array.
        // TODO: allow array of keys to look down
        // TODO: create plugin to allow referencing helpers, filters with dot notation
        return this.cache[key];
    };
    Cacher.prototype.remove = function (key) {
        delete this.cache[key];
    };
    Cacher.prototype.reset = function () {
        this.cache = {};
    };
    Cacher.prototype.load = function (cacheObj) {
        // TODO: this will err with deep objects and `storage` or `plugins` keys.
        // Update Feb 26: EDITED so it shouldn't err
        copyProps(this.cache, cacheObj, true);
    };
    return Cacher;
}());

function setPrototypeOf(obj, proto) {
    if (Object.setPrototypeOf) {
        Object.setPrototypeOf(obj, proto);
    }
    else {
        obj.__proto__ = proto;
    }
}
function SqrlErr(message) {
    var err = new Error(message);
    setPrototypeOf(err, SqrlErr.prototype);
    return err;
}
SqrlErr.prototype = Object.create(Error.prototype, {
    name: { value: 'Squirrelly Error', enumerable: false }
});
// TODO: Class transpilation adds a lot to the bundle size
function ParseErr(message, str, indx) {
    var whitespace = str.slice(0, indx).split(/\n/);
    var lineNo = whitespace.length;
    var colNo = whitespace[lineNo - 1].length + 1;
    message +=
        ' at line ' +
            lineNo +
            ' col ' +
            colNo +
            ':\n\n' +
            '  ' +
            str.split(/\n/)[lineNo - 1] +
            '\n' +
            '  ' +
            Array(colNo).join(' ') +
            '^';
    throw SqrlErr(message);
}

/* END TYPES */
function parse(str, env) {
    var powerchars = new RegExp('([|()]|=>)|' +
        '\'(?:\\\\[\\s\\w"\'\\\\`]|[^\\n\\r\'\\\\])*?\'|`(?:\\\\[\\s\\w"\'\\\\`]|[^\\\\`])*?`|"(?:\\\\[\\s\\w"\'\\\\`]|[^\\n\\r"\\\\])*?"' + // matches strings
        '|\\/\\*[^]*?\\*\\/|((\\/)?(-|_)?' +
        env.tags[1] +
        ')', 'g');
    var tagOpenReg = new RegExp('([^]*?)' + env.tags[0] + '(-|_)?\\s*', 'g');
    var startInd = 0;
    var trimNextLeftWs = '';
    function parseTag() {
        var currentObj = { f: [] };
        var numParens = 0;
        var firstChar = str[startInd];
        var currentAttribute = 'c'; // default - Valid values: 'c'=content, 'f'=filter, 'fp'=filter params, 'p'=param, 'n'=name
        var currentType = 'r'; // Default
        startInd += 1; // assume we're gonna skip the first character
        if (firstChar === '~' || firstChar === '#' || firstChar === '/') {
            currentAttribute = 'n';
            currentType = firstChar;
        }
        else if (firstChar === '!' || firstChar === '?') {
            // ? for custom
            currentType = firstChar;
        }
        else if (firstChar === '*') {
            currentObj.raw = true;
        }
        else {
            startInd -= 1;
        }
        function addAttrValue(indx) {
            var valUnprocessed = str.slice(startInd, indx);
            // console.log(valUnprocessed)
            var val = valUnprocessed.trim();
            if (currentAttribute === 'f') {
                if (val === 'safe') {
                    currentObj.raw = true;
                }
                else {
                    currentObj.f.push([val, '']);
                }
            }
            else if (currentAttribute === 'fp') {
                currentObj.f[currentObj.f.length - 1][1] += val;
            }
            else if (currentAttribute === 'err') {
                if (val) {
                    var found = valUnprocessed.search(/\S/);
                    ParseErr('invalid syntax', str, startInd + found);
                }
            }
            else {
                // if (currentObj[currentAttribute]) { // TODO make sure no errs
                //   currentObj[currentAttribute] += val
                // } else {
                currentObj[currentAttribute] = val;
                // }
            }
            startInd = indx + 1;
        }
        powerchars.lastIndex = startInd;
        var m;
        // tslint:disable-next-line:no-conditional-assignment
        while ((m = powerchars.exec(str)) !== null) {
            var char = m[1];
            var tagClose = m[2];
            var slash = m[3];
            var wsControl = m[4];
            var i = m.index;
            if (char) {
                // Power character
                if (char === '(') {
                    if (numParens === 0) {
                        if (currentAttribute === 'n') {
                            addAttrValue(i);
                            currentAttribute = 'p';
                        }
                        else if (currentAttribute === 'f') {
                            addAttrValue(i);
                            currentAttribute = 'fp';
                        }
                    }
                    numParens++;
                }
                else if (char === ')') {
                    numParens--;
                    if (numParens === 0 && currentAttribute !== 'c') {
                        // Then it's closing a filter, block, or helper
                        addAttrValue(i);
                        currentAttribute = 'err'; // Reset the current attribute
                    }
                }
                else if (numParens === 0 && char === '|') {
                    addAttrValue(i); // this should actually always be whitespace or empty
                    currentAttribute = 'f';
                }
                else if (char === '=>') {
                    addAttrValue(i);
                    startInd += 1; // this is 2 chars
                    currentAttribute = 'res';
                }
            }
            else if (tagClose) {
                addAttrValue(i);
                startInd = i + m[0].length;
                tagOpenReg.lastIndex = startInd;
                // console.log('tagClose: ' + startInd)
                trimNextLeftWs = wsControl;
                if (slash && currentType === '~') {
                    currentType = 's';
                } // TODO throw err
                currentObj.t = currentType;
                return currentObj;
            }
        }
        // TODO: Do I need this?
        ParseErr('unclosed tag', str, str.length);
        return currentObj; // To prevent TypeScript from erroring
    }
    function parseContext(parentObj, firstParse) {
        parentObj.b = []; // assume there will be blocks // TODO: perf optimize this
        parentObj.d = [];
        var lastBlock = false;
        var buffer = [];
        function pushString(strng, shouldTrimRightPrecedingString) {
            if (strng) {
                var stringToPush = strng.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                stringToPush = trimWS(stringToPush, env, trimNextLeftWs, shouldTrimRightPrecedingString);
                if (stringToPush) {
                    buffer.push(stringToPush);
                }
            }
        }
        // Random TODO: parentObj.b doesn't need to have t: #
        var tagOpenMatch;
        // tslint:disable-next-line:no-conditional-assignment
        while ((tagOpenMatch = tagOpenReg.exec(str)) !== null) {
            var precedingString = tagOpenMatch[1];
            var shouldTrimRightPrecedingString = tagOpenMatch[2];
            pushString(precedingString, shouldTrimRightPrecedingString);
            startInd = tagOpenMatch.index + tagOpenMatch[0].length;
            var currentObj = parseTag();
            // ===== NOW ADD THE OBJECT TO OUR BUFFER =====
            var currentType = currentObj.t;
            if (currentType === '~') {
                currentObj = parseContext(currentObj); // currentObj is the parent object
                buffer.push(currentObj);
            }
            else if (currentType === '/') {
                if (parentObj.n === currentObj.n) {
                    if (lastBlock) {
                        // If there's a previous block
                        lastBlock.d = buffer;
                        parentObj.b.push(lastBlock);
                    }
                    else {
                        parentObj.d = buffer;
                    }
                    // console.log('parentObj: ' + JSON.stringify(parentObj))
                    return parentObj;
                }
                else {
                    ParseErr("Helper start and end don't match", str, tagOpenMatch.index + tagOpenMatch[0].length);
                }
            }
            else if (currentType === '#') {
                if (lastBlock) {
                    // If there's a previous block
                    lastBlock.d = buffer;
                    parentObj.b.push(lastBlock);
                }
                else {
                    parentObj.d = buffer;
                }
                lastBlock = currentObj; // Set the 'lastBlock' object to the value of the current block
                buffer = [];
            }
            else {
                buffer.push(currentObj);
            }
            // ===== DONE ADDING OBJECT TO BUFFER =====
        }
        if (firstParse) {
            pushString(str.slice(startInd, str.length));
            parentObj.d = buffer;
        }
        else {
            throw SqrlErr('unclosed helper "' + parentObj.n + '"');
            // It should have returned by now
        }
        return parentObj;
    }
    var parseResult = parseContext({ f: [] }, true);
    // console.log(JSON.stringify(parseResult))
    return parseResult.d; // Parse the very outside context
}

/* END TYPES */
function compileToString(str, env) {
    var buffer = parse(str, env);
    return ("var tR='';" +
        (env.useWith ? 'with(' + env.varName + '||{}){' : '') +
        compileScope(buffer, env)
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r') +
        'if(cb){return cb(null,tR)} return tR' +
        (env.useWith ? '}' : ''));
    // TODO: is `return cb()` necessary, or could we just do `cb()`
}
function filter(str, filters, env) {
    for (var i = 0; i < filters.length; i++) {
        var name = filters[i][0];
        var params = filters[i][1];
        if (env.async) {
            if (env.asyncFilters && env.asyncFilters.includes(name)) {
                str = 'await ' + str;
            }
        }
        str = "c.l('F','" + name + "')(" + str;
        if (params) {
            str += ',' + params;
        }
        str += ')';
    }
    return str;
}
// TODO: Use type intersections for TemplateObject, etc.
// so I don't have to make properties mandatory
function compileHelper(env, res, descendants, params, name) {
    var ret = '{exec:' +
        (env.async ? 'async ' : '') +
        compileScopeIntoFunction(descendants, res, env) +
        ',params:[' +
        params +
        ']';
    if (name) {
        ret += ",name:'" + name + "'";
    }
    ret += '}';
    return ret;
}
function compileBlocks(blocks, env) {
    var ret = '[';
    for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        ret += compileHelper(env, block.res || '', block.d, block.p || '', block.n);
        if (i < blocks.length) {
            ret += ',';
        }
    }
    ret += ']';
    return ret;
}
function compileScopeIntoFunction(buff, res, env) {
    return 'function(' + res + "){var tR='';" + compileScope(buff, env) + 'return tR}';
}
function compileScope(buff, env) {
    var i = 0;
    var buffLength = buff.length;
    var returnStr = '';
    for (i; i < buffLength; i++) {
        var currentBlock = buff[i];
        if (typeof currentBlock === 'string') {
            var str = currentBlock;
            // we know string exists
            returnStr += "tR+='" + str + "';";
        }
        else {
            var type = currentBlock.t; // ~, s, !, ?, r
            var content = currentBlock.c || '';
            var filters = currentBlock.f;
            var name = currentBlock.n || '';
            var params = currentBlock.p || '';
            var res = currentBlock.res || '';
            var blocks = currentBlock.b;
            if (type === 'r') {
                if (!currentBlock.raw && env.autoEscape) {
                    content = "c.l('F','e')(" + content + ')';
                }
                var filtered = filter(content, filters, env);
                returnStr += 'tR+=' + filtered + ';';
                // reference
            }
            else if (type === '~') {
                // helper
                if (env.storage.nativeHelpers.get(name)) {
                    returnStr += env.storage.nativeHelpers.get(name)(currentBlock, env);
                }
                else {
                    var helperReturn = (env.async /* && env.asyncHelpers && env.asyncHelpers.includes(name) */
                        ? 'await '
                        : '') +
                        "c.l('H','" +
                        name +
                        "')(" +
                        compileHelper(env, res, currentBlock.d, params);
                    if (blocks) {
                        helperReturn += ',' + compileBlocks(blocks, env);
                    }
                    else {
                        helperReturn += ',[]';
                    }
                    helperReturn += ',c)';
                    returnStr += 'tR+=' + filter(helperReturn, filters, env) + ';';
                }
            }
            else if (type === 's') {
                returnStr +=
                    'tR+=' +
                        filter((env.async && env.asyncHelpers && env.asyncHelpers.includes(name) ? 'await ' : '') +
                            "c.l('H','" +
                            name +
                            "')({params:[" +
                            params +
                            ']},[],c)', filters, env) +
                        ';';
                // self-closing helper
            }
            else if (type === '!') {
                // execute
                returnStr += content;
            }
        }
    }
    return returnStr;
}

/* END TYPES */
var templates = new Cacher({});
function errWithBlocksOrFilters(name, blocks, // false means don't check
filters, native) {
    if (blocks && blocks.length > 0) {
        throw SqrlErr((native ? 'Native' : '') + "Helper '" + name + "' doesn't accept blocks");
    }
    if (filters && filters.length > 0) {
        throw SqrlErr((native ? 'Native' : '') + "Helper '" + name + "' doesn't accept filters");
    }
}
var helpers = new Cacher({
    each: function (content) {
        var res = '';
        var param = content.params[0];
        for (var i = 0; i < param.length; i++) {
            res += content.exec(param[i], i);
        }
        return res;
    },
    foreach: function (content) {
        var res = '';
        var param = content.params[0];
        for (var key in param) {
            if (!hasOwnProp(param, key))
                continue;
            res += content.exec(key, param[key]); // todo: I think this is wrong?
        }
        return res;
    },
    include: function (content, blocks, config) {
        errWithBlocksOrFilters('include', blocks, false);
        var template = config.storage.templates.get(content.params[0]);
        if (!template) {
            throw SqrlErr('Could not fetch template "' + content.params[0] + '"');
        }
        return template(content.params[1], config);
    },
    extends: function (content, blocks, config) {
        var data = content.params[1] || {};
        data.content = content.exec();
        for (var i = 0; i < blocks.length; i++) {
            var currentBlock = blocks[i];
            data[currentBlock.name] = currentBlock.exec();
        }
        var template = config.storage.templates.get(content.params[0]);
        if (!template) {
            throw SqrlErr('Could not fetch template "' + content.params[0] + '"');
        }
        return template(data, config);
    },
    useScope: function (content, blocks) {
        errWithBlocksOrFilters('useScope', blocks, false);
        return content.exec(content.params[0]);
    }
});
var nativeHelpers = new Cacher({
    if: function (buffer, env) {
        errWithBlocksOrFilters('if', false, buffer.f, true);
        var returnStr = 'if(' + buffer.p + '){' + compileScope(buffer.d, env) + '}';
        if (buffer.b) {
            for (var i = 0; i < buffer.b.length; i++) {
                var currentBlock = buffer.b[i];
                if (currentBlock.n === 'else') {
                    returnStr += 'else{' + compileScope(currentBlock.d, env) + '}';
                }
                else if (currentBlock.n === 'elif') {
                    returnStr += 'else if(' + currentBlock.p + '){' + compileScope(currentBlock.d, env) + '}';
                }
            }
        }
        return returnStr;
    },
    try: function (buffer, env) {
        errWithBlocksOrFilters('try', false, buffer.f, true);
        if (!buffer.b || buffer.b.length !== 1 || buffer.b[0].n !== 'catch') {
            throw SqrlErr("native helper 'try' only accepts 1 block, 'catch'");
        }
        var returnStr = 'try{' + compileScope(buffer.d, env) + '}';
        var currentBlock = buffer.b[0];
        returnStr +=
            'catch' +
                (currentBlock.res ? '(' + currentBlock.res + ')' : '') +
                '{' +
                compileScope(currentBlock.d, env) +
                '}';
        return returnStr;
    },
    block: function (buffer, env) {
        errWithBlocksOrFilters('block', buffer.b, buffer.f, true);
        var returnStr = 'if(!' +
            env.varName +
            '[' +
            buffer.p +
            ']){tR+=(' +
            compileScopeIntoFunction(buffer.d, '', env) +
            ')()}else{tR+=' +
            env.varName +
            '[' +
            buffer.p +
            ']}';
        return returnStr;
    }
});
var escMap = {
    '&': '&amp;',
    '<': '&lt;',
    '"': '&quot;',
    "'": '&#39;'
};
function replaceChar(s) {
    return escMap[s];
}
function XMLEscape(str) {
    // To deal with XSS. Based on Escape implementations of Mustache.JS and Marko, then customized.
    var newStr = String(str);
    if (/[&<"']/.test(newStr)) {
        return newStr.replace(/[&<"']/g, replaceChar);
    }
    else {
        return newStr;
    }
}
var filters = new Cacher({ e: XMLEscape });

/* END TYPES */
var defaultConfig = {
    varName: 'it',
    autoTrim: [false, 'nl'],
    autoEscape: true,
    defaultFilter: false,
    tags: ['{{', '}}'],
    l: function (container, name) {
        if (container === 'H') {
            var hRet = this.storage.helpers.get(name);
            if (hRet) {
                return hRet;
            }
            else {
                throw SqrlErr("Can't find helper '" + name + "'");
            }
        }
        else if (container === 'F') {
            var fRet = this.storage.filters.get(name);
            if (fRet) {
                return fRet;
            }
            else {
                throw SqrlErr("Can't find filter '" + name + "'");
            }
        }
    },
    async: false,
    storage: {
        helpers: helpers,
        nativeHelpers: nativeHelpers,
        filters: filters,
        templates: templates
    },
    asyncHelpers: ['include', 'includeFile'],
    cache: false,
    plugins: {
        processAST: [],
        processFnString: []
    },
    useWith: false
};
defaultConfig.l.bind(defaultConfig);
function getConfig(override, baseConfig) {
    // TODO: run more tests on this
    var res = {}; // Linked
    copyProps(res, defaultConfig); // Creates deep clone of res, 1 layer deep
    if (baseConfig) {
        copyProps(res, baseConfig);
    }
    if (override) {
        copyProps(res, override);
    }
    res.l.bind(res);
    return res;
}

/* END TYPES */
function compile(str, env) {
    var options = getConfig(env || {});
    var ctor; // constructor
    /* ASYNC HANDLING */
    // The below code is modified from mde/ejs. All credit should go to them.
    if (options.async) {
        // Have to use generated function for this, since in envs without support,
        // it breaks in parsing
        try {
            ctor = new Function('return (async function(){}).constructor;')();
        }
        catch (e) {
            if (e instanceof SyntaxError) {
                throw new Error("This environment doesn't support async/await");
            }
            else {
                throw e;
            }
        }
    }
    else {
        ctor = Function;
    }
    /* END ASYNC HANDLING */
    try {
        return new ctor(options.varName, 'c', // SqrlConfig
        'cb', // optional callback
        compileToString(str, options)); // eslint-disable-line no-new-func
    }
    catch (e) {
        if (e instanceof SyntaxError) {
            throw SqrlErr('Bad template syntax\n\n' +
                e.message +
                '\n' +
                Array(e.message.length + 1).join('=') +
                '\n' +
                compileToString(str, options));
        }
        else {
            throw e;
        }
    }
}

var fs = require('fs');
var path = require('path');
var _BOM = /^\uFEFF/;
/* END TYPES */
/**
 * Get the path to the included file from the parent file path and the
 * specified path.
 *
 * @param {String}  name       specified path
 * @param {String}  parentfile parent file path
 * @param {Boolean} [isDir=false] whether parent file path is a directory
 * @return {String}
 */
function getWholeFilePath(name, parentfile, isDirectory) {
    var includePath = path.resolve(isDirectory ? parentfile : path.dirname(parentfile), // returns directory the parent file is in
    name // file
    );
    var ext = path.extname(name);
    if (!ext) {
        includePath += '.sqrl';
    }
    return includePath;
}
/**
 * Get the path to the included file by Options
 *
 * @param  {String}  path    specified path
 * @param  {Options} options compilation options
 * @return {String}
 */
function getPath(path, options) {
    var includePath;
    var filePath;
    var views = options.views;
    var match = /^[A-Za-z]+:\\|^\//.exec(path);
    // Abs path
    if (match && match.length) {
        includePath = getWholeFilePath(path.replace(/^\/*/, ''), options.root || '/', true);
    }
    else {
        // Relative paths
        // Look relative to a passed filename first
        if (options.filename) {
            filePath = getWholeFilePath(path, options.filename);
            if (fs.existsSync(filePath)) {
                includePath = filePath;
            }
        }
        // Then look in any views directories
        if (!includePath) {
            if (Array.isArray(views) &&
                views.some(function (v) {
                    filePath = getWholeFilePath(path, v, true);
                    return fs.existsSync(filePath);
                })) {
                includePath = filePath;
            }
        }
        if (!includePath) {
            throw SqrlErr('Could not find the include file "' + path + '"');
        }
    }
    return includePath;
}
function readFile(filePath) {
    return fs
        .readFileSync(filePath)
        .toString()
        .replace(_BOM, ''); // TODO: is replacing BOM's necessary?
}
function loadFile(filePath, options) {
    var config = getConfig(options);
    var template = readFile(filePath);
    try {
        var compiledTemplate = compile(template, config);
        config.storage.templates.define(config.filename, compiledTemplate);
        return compiledTemplate;
    }
    catch (e) {
        throw SqrlErr('Loading file: ' + filePath + ' failed');
    }
}

// express is set like: app.engine('html', require('squirrelly').renderFile)
/* END TYPES */
/**
 * Get the template from a string or a file, either compiled on-the-fly or
 * read from cache (if enabled), and cache the template if needed.
 *
 * If `options.cache` is true, this function reads the file from
 * `options.filename` so it must be set prior to calling this function.
 *
 * @param {Options} options   compilation options
 * @param {String} [template] template source
 * @return {(TemplateFunction|ClientFunction)}
 * Depending on the value of `options.client`, either type might be returned.
 * @static
 */
function handleCache(options) {
    var filename = options.filename;
    if (options.cache) {
        var func = options.storage.templates.get(filename);
        if (func) {
            return func;
        }
        else {
            return loadFile(filename, options);
        }
    }
    return compile(readFile(filename), options);
}
/**
 * Try calling handleCache with the given options and data and call the
 * callback with the result. If an error occurs, call the callback with
 * the error. Used by renderFile().
 *
 * @param {Options} options    compilation options
 * @param {Object} data        template data
 * @param {RenderFileCallback} cb callback
 * @static
 */
function tryHandleCache(options, data, cb) {
    var result;
    if (!cb) {
        // No callback, try returning a promise
        if (typeof promiseImpl === 'function') {
            return new promiseImpl(function (resolve, reject) {
                try {
                    result = handleCache(options)(data, options);
                    resolve(result);
                }
                catch (err) {
                    reject(err);
                }
            });
        }
        else {
            throw SqrlErr("Please provide a callback function, this env doesn't support Promises");
        }
    }
    else {
        try {
            handleCache(options)(data, options, cb);
        }
        catch (err) {
            return cb(err);
        }
    }
}
/**
 * Get the template function.
 *
 * If `options.cache` is `true`, then the template is cached.
 *
 * @param {String}  path    path for the specified file
 * @param {Options} options compilation options
 * @return {(TemplateFunction|ClientFunction)}
 * Depending on the value of `options.client`, either type might be returned
 * @static
 */
function includeFile(path, options) {
    // the below creates a new options object, using the parent filepath of the old options object and the path
    var newFileOptions = getConfig({ filename: getPath(path, options) }, options);
    // TODO: make sure properties are currectly copied over
    return handleCache(newFileOptions);
}
function renderFile(filename, data, cb) {
    var Config = getConfig(data || {});
    // TODO: make sure above doesn't error. We do set filename down below
    if (data.settings) {
        // Pull a few things from known locations
        if (data.settings.views) {
            Config.views = data.settings.views;
        }
        if (data.settings['view cache']) {
            Config.cache = true;
        }
        // Undocumented after Express 2, but still usable, esp. for
        // items that are unsafe to be passed along with data, like `root`
        var viewOpts = data.settings['view options'];
        if (viewOpts) {
            copyProps(Config, viewOpts);
        }
    }
    Config.filename = filename; // Make sure filename is right
    return tryHandleCache(Config, data, cb);
}

/* END TYPES */
function includeFileHelper(content, blocks, config) {
    if (blocks && blocks.length > 0) {
        throw SqrlErr("Helper 'includeFile' doesn't accept blocks");
    }
    return includeFile(content.params[0], config)(content.params[1], config);
}
function extendsFileHelper(content, blocks, config) {
    var data = content.params[1] || {};
    data.content = content.exec();
    for (var i = 0; i < blocks.length; i++) {
        var currentBlock = blocks[i];
        data[currentBlock.name] = currentBlock.exec();
    }
    return includeFile(content.params[0], config)(data, config);
}

/* END TYPES */
function handleCache$1(template, options) {
    var templateFunc;
    if (options.cache && options.name && options.storage.templates.get(options.name)) {
        return options.storage.templates.get(options.name);
    }
    if (typeof template === 'function') {
        templateFunc = template;
    }
    else {
        templateFunc = compile(template, options);
    }
    if (options.cache && options.name) {
        options.storage.templates.define(options.name, templateFunc);
    }
    return templateFunc;
}
function render(template, data, env, cb) {
    var options = getConfig(env || {});
    if (options.async) {
        var result;
        if (!cb) {
            // No callback, try returning a promise
            if (typeof promiseImpl === 'function') {
                return new promiseImpl(function (resolve, reject) {
                    try {
                        result = handleCache$1(template, options)(data, options);
                        resolve(result);
                    }
                    catch (err) {
                        reject(err);
                    }
                });
            }
            else {
                throw SqrlErr("Please provide a callback function, this env doesn't support Promises");
            }
        }
        else {
            try {
                handleCache$1(template, options)(data, options, cb);
            }
            catch (err) {
                return cb(err);
            }
        }
    }
    else {
        return handleCache$1(template, options)(data, options);
    }
}

/* Export file stuff */
/* END TYPES */
helpers.define('includeFile', includeFileHelper);
helpers.define('extendsFile', extendsFileHelper);

export { renderFile as __express, compile, compileScope, compileScopeIntoFunction, compileToString, defaultConfig, filters, getConfig, helpers, loadFile, nativeHelpers, parse, render, renderFile, templates };
//# sourceMappingURL=squirrelly.es.js.map
