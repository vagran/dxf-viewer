/**
 * DxfArrayScanner
 *
 * Based off the AutoCad 2012 DXF Reference
 * http://images.autodesk.com/adsk/files/autocad_2012_pdf_dxf-reference_enu.pdf
 *
 * Reads through an array representing lines of a dxf file. Takes an array and
 * provides an easy interface to extract group code and value pairs.
 * @param data - an array where each element represents a line in the dxf file
 * @constructor
 */
export default function DxfArrayScanner(data) {
    this._pointer = 0;
    this._data = data;
    this._eof = false;
}

/**
 * Gets the next group (code, value) from the array. A group is two consecutive elements
 * in the array. The first is the code, the second is the value.
 * @returns {{code: Number}|*}
 */
DxfArrayScanner.prototype.next = function() {
    var group;
    if(!this.hasNext()) {
        if(!this._eof)
            throw new Error('Unexpected end of input: EOF group not read before end of file. Ended on code ' + this._data[this._pointer]);
        else
            throw new Error('Cannot call \'next\' after EOF group has been read');
    }

    group = {
        code: parseInt(this._data[this._pointer])
    };

    this._pointer++;

    group.value = parseGroupValue(group.code, this._data[this._pointer]);
    
    this._pointer++;

    if(group.code === 0 && group.value === 'EOF') this._eof = true;

    this.lastReadGroup = group;

    return group;
};

DxfArrayScanner.prototype.peek = function() {
    if(!this.hasNext()) {
        if(!this._eof)
            throw new Error('Unexpected end of input: EOF group not read before end of file. Ended on code ' + this._data[this._pointer]);
        else
            throw new Error('Cannot call \'next\' after EOF group has been read');
    }
    
    var group = {
        code: parseInt(this._data[this._pointer])
    };

    group.value = parseGroupValue(group.code, this._data[this._pointer + 1]);

    return group;
};


DxfArrayScanner.prototype.rewind = function(numberOfGroups) {
    numberOfGroups = numberOfGroups || 1;
    this._pointer = this._pointer - numberOfGroups * 2;
};

/**
 * Returns true if there is another code/value pair (2 elements in the array).
 * @returns {boolean}
 */
DxfArrayScanner.prototype.hasNext = function() {
    // Check if we have read EOF group code
    if(this._eof) {
        return false;
    }
    
    // We need to be sure there are two lines available
    if(this._pointer > this._data.length - 2) {
        return false;
    }
    return true;
};

/**
 * Returns true if the scanner is at the end of the array
 * @returns {boolean}
 */
DxfArrayScanner.prototype.isEOF = function() {
    return this._eof;
};

/**
 * Parse a value to its proper type.
 * See pages 3 - 10 of the AutoCad DXF 2012 reference given at the top of this file
 *
 * @param code
 * @param value
 * @returns {*}
 */
function parseGroupValue(code, value) {
    if(code <= 9) return value;
    if(code >= 10 && code <= 59) return parseFloat(value.trim());
    if(code >= 60 && code <= 99) return parseInt(value.trim());
    if(code >= 100 && code <= 109) return value;
    if(code >= 110 && code <= 149) return parseFloat(value.trim());
    if(code >= 160 && code <= 179) return parseInt(value.trim());
    if(code >= 210 && code <= 239) return parseFloat(value.trim());
    if(code >= 270 && code <= 289) return parseInt(value.trim());
    if(code >= 290 && code <= 299) return parseBoolean(value.trim());
    if(code >= 300 && code <= 369) return value;
    if(code >= 370 && code <= 389) return parseInt(value.trim());
    if(code >= 390 && code <= 399) return value;
    if(code >= 400 && code <= 409) return parseInt(value.trim());
    if(code >= 410 && code <= 419) return value;
    if(code >= 420 && code <= 429) return parseInt(value.trim());
    if(code >= 430 && code <= 439) return value;
    if(code >= 440 && code <= 459) return parseInt(value.trim());
    if(code >= 460 && code <= 469) return parseFloat(value.trim());
    if(code >= 470 && code <= 481) return value;
    if(code === 999) return value;
    if(code >= 1000 && code <= 1009) return value;
    if(code >= 1010 && code <= 1059) return parseFloat(value.trim());
    if(code >= 1060 && code <= 1071) return parseInt(value.trim());

    console.log('WARNING: Group code does not have a defined type: %j', { code: code, value: value });
    return value;
}

/**
 * Parse a boolean according to a 1 or 0 value
 * @param str
 * @returns {boolean}
 */
function parseBoolean(str) {
    if(str === '0') return false;
    if(str === '1') return true;
    throw TypeError('String \'' + str + '\' cannot be cast to Boolean type');
}