'use strict';

function safeUnixSeconds() {
    return Math.floor(Date.now() / 1000);
}

module.exports = {
    safeUnixSeconds,
};
