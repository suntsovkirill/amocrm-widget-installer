#! /usr/bin/env node

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const argparse = require('argparse');
const request = require('request-promise');
const contentType = require('content-type');


class WidgetInstaller {
    constructor(domain, login, api_key = null, needUpdate = 0) {
        this.login = login;
        this.api_key = api_key;
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
                'USER_HASH': this.api_key
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
            console.log(`Coздан виджет с кодом: ${code}`);
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
                    console.log(`Найден виджет с кодом ${item.code} и секретным ключом ${item.secret_key}.`);
                    return [item['code'], item['secret_key']];
                }
            }
            return [null, null];
        }
    }

    async uploadWidget(archivePath, secretKey, widgetCode) {
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
                'widget': widgetCode,
                'amouser': this.login,
                'amohash': this.api_key,
                'domain': `amocrm.ru`
            }
        });

        const text = JSON.parse(result.replace(/^<script(.*)script>/, ''));

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

        manifest.widget.code = code;
        manifest.widget.secret_key = secret_key;

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

        let [code, secretKey] = [...await wi.findWidgetData(args.name)];

        if (!code) {
            [code, secretKey] = [...await wi.createWidgetKey(args.name)];
        } else if (!args.update) {
            return console.log(`Виджет с кодом ${code} уже существует, для его обновления укажите параметр --update`);
        }

        WidgetInstaller.updateManifest(args.folder, secretKey, code);

        const archivePath = await WidgetInstaller.zipArchive(args.folder);
        await wi.uploadWidget(archivePath, secretKey, code);
    } catch (e) {
        console.error(e.message);
    }
})();
