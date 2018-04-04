#! /usr/bin/env node

const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const axios = require('axios');
const archiver = require('archiver');
const argparse = require('argparse');


class WidgetInstaller {
    constructor(domain, login, api_key = null, needUpdate = 0) {
        this.login = login;
        this.api_key = api_key;
        this.domain = domain;
        this.needUpdate = needUpdate;

        this._request = axios.create({
            baseURL: `https://${this.domain}.amocrm.ru/`,
            timeout: 60000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:51.0) Gecko/20100101 Firefox/51.0',
                'X-Requested-With': 'XMLHttpRequest'
            },
            validateStatus(status) {
                return (status === 200 || status === 204);
            }
        });

        this._request.interceptors.response.use(response => {
            if (response && typeof response.headers === 'object' && 'set-cookie' in response.headers) {
                if (!('Cookie' in this._request.defaults.headers.common)) {
                    this._request.defaults.headers.common['Cookie'] = response.headers['set-cookie'].join('; ');
                }
            }
            return response;
        });
    }

    auth() {
        return this._request.get('/private/api/auth.php?type=json', {
            data: {
                'USER_LOGIN': this.login,
                'USER_HASH': this.api_key
            }
        });
    }

    async createWidgetKey(code) {
        const result = await this._request.post('/ajax/settings/dev/', querystring.stringify({action: 'create', code}), {
            headers: {
                "Content-Type" : "application/x-www-form-urlencoded; charset=UTF-8"
            }
        });

        if ('error' in result.data) {
            throw new Error(result.data.error);
        } else {
            console.log(`Coздан виджет с кодом: ${code}`);
            return await this.findWidgetData(code);
        }
    }

    async findWidgetData(code) {
        const result = await this._request.get('/ajax/settings/dev/');

        if ('error' in result.data) {
            throw new Error(result.data.error);
        } else {
            const items = result.data['response']['widgets']['items'];

            for (let item of items) {
                if (typeof item === 'object' && item.hasOwnProperty('code') && item.code === code) {
                    console.log(`Найден виджет с кодом ${item['code']} и секретным ключом ${item['secret_key']}.`);
                    return [item['code'], item['secret_key']];
                }
            }
            return [null, null];
        }
    }

    async uploadWidget(archivePath, secretKey, widgetCode) {
        const result = await this._request.post(`https://widgets.amocrm.ru/${this.domain}/upload/`, {
            ' widget': fs.readFileSync(archivePath),
            'secret': secretKey,
            'widget': widgetCode,
            'amouser': this.login,
            'amohash': this.api_key,
            'domain': `amocrm.ru`
        }, {
            transformRequest: [(data, headers) => {
                const boundary = '-----------------------------' + Date.now();
                headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;

                const tohex = (value) => Buffer.from(value).toString('hex');

                let result = tohex('\r\n\r\n');

                for (let key in data) {
                    result += tohex(`--${boundary}\r\n`);
                    if (key === ' widget') {
                        result += tohex('Content-Disposition: form-data; name="widget"; filename="widget.zip"\r\nContent-Type: application/x-zip-compressed\r\n\r\n');
                        result += tohex(data[key]);
                        result += tohex('\r\n');
                    } else {
                        result += tohex(`Content-Disposition: form-data; name="${key}"\r\n\r\n`);
                        result += tohex(data[key] + '\r\n');
                    }
                }

                result += tohex(`--${boundary}--\r\n`);

                return Buffer.from(result, 'hex');
            }],
        });

        const text = JSON.parse(result.data.replace(/^<script(.*)script>/, ''));

        if ('error' in text) {
            throw new Error(text.error)
        } else {
            console.log(`Виджет ${widgetCode} успешно загружен`);
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
                console.log(`Создан архив ${widgetPath}`);
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

    static updateManifest(widgetFolder, secret_key, code) {
        const manifestPath = path.resolve(widgetFolder, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        manifest['widget']['code'] = code;
        manifest['widget']['secret_key'] = secret_key;

        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        console.log('Файл manifest.json изменен.');
        return true;
    }
}

(async () => {
    try {
        const parser = argparse.ArgumentParser();

        parser.addArgument(['-l', '--login'], {help: 'Логин', required: true});
        parser.addArgument(['-a', '--apikey'], {help: 'API-ключ', required: true});
        parser.addArgument(['-d', '--subdomain'], {help: 'Субдомен', required: true});
        parser.addArgument(['-n', '--name'], {help: 'Имя виджета', required: true});
        parser.addArgument(['-f', '--folder'], {help: 'Папка с файлами виджета', required: true});
        parser.addArgument('--update', {
                help: 'Обновить существующий виджет',
                nargs: '',
                type: Boolean,
                const: true,
                default: false
            }
        );

        const args = parser.parseArgs();

        const wi = new WidgetInstaller(args.subdomain, args.login, args.apikey, args.update);
        await wi.auth();

        let [code, secret_key] = [...await wi.findWidgetData(args.name)];

        if (!code) {
            [code, secret_key] = [...await wi.createWidgetKey(args.name)];
        } else if (!args.update) {
            console.log(`Виджет с кодом ${code} уже существует, для его обновления укажите параметр --update`);
            return;
        }

        WidgetInstaller.updateManifest(args.folder, secret_key, code);

        const archivePath = await WidgetInstaller.zipArchive(args.folder);
        await wi.uploadWidget(archivePath, secret_key, code);
    } catch (e) {
        console.error(e.message);
    }
})();
