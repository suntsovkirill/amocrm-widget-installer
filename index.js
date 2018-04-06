const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const request = require('request-promise');
const contentType = require('content-type');


class WidgetInstaller {
    constructor(domain, login, apikey = null, needUpdate = 0) {
        this.login = login;
        this.apikey = apikey;
        this.domain = domain;
        this.needUpdate = needUpdate;

        this._request = request.defaults({
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:51.0) Gecko/20100101 Firefox/51.0',
                'X-Requested-With': 'XMLHttpRequest'
            },
            jar: true,
            transform(body, response) {
                const ct = contentType.parse(response.headers['content-type']);
                if (ct.type === 'application/json' || ct.type === 'text/json') {
                    return JSON.parse(body);
                }

                return body;
            }
        });
    }

    auth() {
        return this._request.get(`https://${this.domain}.amocrm.ru/private/api/auth.php`, {
            qs: {
                'type': 'json',
                'USER_LOGIN': this.login,
                'USER_HASH': this.apikey
            }
        });
    }

    async createWidgetKey(code) {
        const result = await this._request.post(`https://${this.domain}.amocrm.ru/ajax/settings/dev/`, {
            formData: {action: 'create', code}
        });

        if ('error' in result) {
            throw new Error(result.error);
        } else {
            return await this.findWidgetData(code);
        }
    }

    async findWidgetData(code) {
        const result = await this._request.get(`https://${this.domain}.amocrm.ru/ajax/settings/dev/`);

        if ('error' in result) {
            throw new Error(result.error);
        } else {
            const items = result.response.widgets.items;

            for (let item of items) {
                if (typeof item === 'object' && item.hasOwnProperty('code') && item.code === code) {
                    return [item['code'], item['secret_key']];
                }
            }
            return [null, null];
        }
    }

    async uploadWidget(archivePath, code, secretKey) {
        const result = await this._request.post(`https://widgets.amocrm.ru/${this.domain}/upload/`, {
            formData: {
                ' widget': {
                    value: fs.createReadStream(archivePath),
                    options: {
                        filename: 'widget.zip',
                        contentType: 'application/x-zip-compressed'
                    }
                },
                'secret': secretKey,
                'widget': code,
                'amouser': this.login,
                'amohash': this.apikey,
                'domain': `amocrm.ru`
            }
        });

        const text = JSON.parse(result.replace(/^<script(.*)script>/, ''));

        if ('error' in text) {
            throw new Error(text.error)
        }
    }

    async deleteWidget(code, secretKey) {
        const result = await this._request.post(`https://widgets.amocrm.ru/${this.domain}/delete/`, {
            formData: {
                'secret': secretKey,
                'widget': code,
                'amouser': this.login,
                'amohash': this.apikey,
            }
        });

        const text = JSON.parse(result.replace(/^<script(.*)script>/, ''));

        if ('error' in text) {
            throw new Error(text.error)
        }
    }

    static zipArchive(widgetFolder) {
        return new Promise((resolve, reject) => {
            const widgetPath = path.resolve('widget.zip');
            const widgetFileStream = fs.createWriteStream(widgetPath);

            const archive = archiver('zip', {
                zlib: {level: 9}
            });

            widgetFileStream.on('close', () => {
                resolve(widgetPath);
            });

            archive.on('error', (err) => {
                reject(err);
            });

            archive.pipe(widgetFileStream);
            archive.directory(path.resolve(widgetFolder), false);
            archive.finalize();
        });
    }

    static updateManifest(widgetFolder, code, secretKey) {
        const manifestPath = path.resolve(widgetFolder, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        manifest.widget.code = code;
        manifest.widget.secret_key = secretKey;

        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        return true;
    }
}

module.exports = WidgetInstaller;
