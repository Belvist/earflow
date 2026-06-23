const pool = require('./pool');
const schemaCapabilities = require('./schemaCapabilities');
const songs = require('./songs');
const artists = require('./artists');
const artistUploaders = require('./artistUploaders');
const artistOwnerships = require('./artistOwnerships');
const likes = require('./likes');
const dislikes = require('./dislikes');
const listens = require('./listens');
const users = require('./users');
const eq = require('./eq');

module.exports = {
    pool,
    schemaCapabilities,
    songs,
    artists,
    artistUploaders,
    artistOwnerships,
    likes,
    dislikes,
    listens,
    users,
    eq,
};
