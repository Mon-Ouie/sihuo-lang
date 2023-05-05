const path = require('path');

module.exports = {
    entry: './index.js',

    output: {
        filename: 'storm.js',
        path: path.resolve(__dirname, 'dist'),
    },

    externals: {
        'fs': 'null', 'jschardet': 'null', 'iconv-lite': 'null'
    },

    mode: "development"
};
