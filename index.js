/**
 * webpack-concat-svg-plugin based on webpack-concat-plugin (@author huangxueliang)
 */
const fs = require('fs');
const SVGO = require('svgo');
const md5 = require('md5');
const path = require('path');

class ConcatSvgPlugin {
    constructor(options) {
        this.settings = Object.assign({}, {
            /**
            * If true using SVGO with default options;
            * If false not using SVGO;
            * Also you can pass SVGO options object;
            * @param Boolean|Object
            */
            svgo: false, 
    
            /**
            * Use hash in filename
            * @param Boolean
            */
            useHash: false,
        
            /**
            * Name of file
            * @param String
            */
            name: 'svg-sprite',
        
            /**
            * File name template 
            * @param String
            */
            fileName: '[name].[hash].svg',

            /**
            * List of files, which should be concatenated
            * @param Array<String>
            */
            filesToConcat: []
        }, options);

        let svgoParams = {
            full: true,
            multipass: false,
            plugins: [
                { removeDesc: {removeAny: true} },
                { removeTitle: {} }, // pass it an argument to enable
                'removeComments', // does enable default plugins. (using { full: true } )
                'removeMetadata',
            ]
        };

        if (typeof this.settings.svgo === 'object') {
            svgoParams = Object.assign({}, svgoParams, this.settings.svgo);
        }

        // used to determine if we should emit files during compiler emit event
        this.svgo = new SVGO(svgoParams);
        this.startTime = Date.now();
        this.prevTimestamps = {};
        this.filesToConcatAbsolute = options.filesToConcat
            .map(f => path.resolve(f));
    }

    getFileName(files, filePath = this.settings.fileName) {
        const fileRegExp = /\[name\]/;
        const hashRegExp = /\[hash\]/;

        if (this.settings.useHash || hashRegExp.test(filePath)) {
            const fileMd5 = this.md5File(files);

            if (!hashRegExp.test(filePath)) {
                filePath = filePath.replace(/\.svg$/, '.[hash].svg');
            }
            filePath = filePath.replace(hashRegExp, fileMd5.slice(0, 20));
        }
        return filePath.replace(fileRegExp, this.settings.name);
    }

    md5File(files) {
        if (this.fileMd5) {
            return this.fileMd5;
        }
        const content = Object.keys(files)
            .reduce((fileContent, fileName) => (fileContent + files[fileName]), '');

        this.fileMd5 = md5(content);
        return this.fileMd5;
    }

    svgFormat(filesContent) {
        return (
            `<?xml version="1.0" encoding="utf-8"?> 
            <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"> 
            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"> 
                ${filesContent} 
            </svg>`
        );
    }

    apply(compiler) {
        const self = this;
        let content = '';
        
        const concatPromise = () => self.settings.filesToConcat.map(fileName =>
            new Promise((resolve, reject) => {
                fs.readFile(fileName, (err, data) => {
                    if (err) {
                        throw err;
                    }
                    resolve({
                        [fileName]: data.toString()
                    });
                });
            }, (err) => {
                console.log(err);
            })
        );

        const dependenciesChanged = compilation => {
            const fileTimestampsKeys = Object.keys(compilation.fileTimestamps);
            // Since there are no time stamps, assume this is the first run and emit files
            if (!fileTimestampsKeys.length) {
                return true;
            }
            const changed = fileTimestampsKeys.filter(watchfile =>
                (self.prevTimestamps[watchfile] || self.startTime) < (compilation.fileTimestamps[watchfile] || Infinity)
            ).some(f => self.filesToConcatAbsolute.includes(f));
            this.prevTimestamps = compilation.fileTimestamps;
            return changed;
        };

        const processContent = (compilation, content, callback) => {
            compilation.assets[self.settings.fileName] = {
                source() {
                    return content;
                },
                size() {
                    return content.length;
                }
            };
    
            callback();
        }

        compiler.plugin('emit', (compilation, callback) => {

            compilation.fileDependencies.push(...self.filesToConcatAbsolute);
            if (!dependenciesChanged(compilation)) {
                return callback();
            }

            Promise.all(concatPromise()).then(files => {
                const allFiles = files.reduce((file1, file2) => Object.assign(file1, file2));
                const filesContent = self.svgFormat(Object.values(allFiles).join(''));

                self.settings.fileName = self.getFileName(allFiles);

                if (process.env.NODE_ENV === 'production' || self.settings.svgo) {
                    self.svgo.optimize(filesContent, function(result) {
                        content = result.data;
                        
                        processContent(compilation, content, callback);
                    });
                }
                else {
                    processContent(compilation, filesContent, callback);
                }
            }, (err) => {
                console.log(err);
            });
        });

        compiler.plugin('compilation', compilation => {
            compilation.plugin('html-webpack-plugin-before-html-generation', (htmlPluginData, callback) => {
                htmlPluginData.assets.webpackConcatSvg = htmlPluginData.assets.webpackConcatSvg || {};
                htmlPluginData.assets.webpackConcatSvg[self.settings.name] = content;
                callback(null, htmlPluginData);
            });
        });
    }
}

module.exports = ConcatSvgPlugin;
