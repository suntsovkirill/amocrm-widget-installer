#! /usr/bin/env node

const argparse = require('argparse');

const WidgetInstaller = require('./index');


(async () => {
    try {
        const parser = argparse.ArgumentParser();

        parser.addArgument(['-l', '--login'], {help: 'Логин', required: true});
        parser.addArgument(['-a', '--apikey'], {help: 'API-ключ', required: true});
        parser.addArgument(['-d', '--subdomain'], {help: 'Субдомен', required: true});
        parser.addArgument(['-n', '--name'], {help: 'Имя виджета', required: true});
        parser.addArgument(['-f', '--folder'], {help: 'Папка с файлами виджета'});
        parser.addArgument('--update', {
            help: 'Обновить существующий виджет',
            nargs: '',
            type: Boolean,
            const: true,
            default: false
        });
        parser.addArgument('--delete', {
            help: 'Удалить существующий виджет',
            nargs: '',
            type: Boolean,
            const: true,
            default: false
        });

        const args = parser.parseArgs();

        if (args.update && args.delete) {
            return console.log(`Нельзя указывать аргументы --update и --remove вместе.`);
        }

        if (!args.delete && !args.folder) {
            return console.log(`Не указан папка виджета, аргумент -f.`);
        }

        const wi = new WidgetInstaller(args.subdomain, args.login, args.apikey, args.update);
        await wi.auth();

        let [code, secretKey] = [...await wi.findWidgetData(args.name)];

        if (!code) {
            if (args.delete) {
                return console.log(`Невозможно удалить виджет с кодом ${args.name}`);
            }

            [code, secretKey] = [...await wi.createWidgetKey(args.name)];
            console.log(`Создан виджет с кодом ${code} и секретным ключом ${secretKey}.`);
        } else {
            if (args.delete) {
                await wi.deleteWidget(code, secretKey);
                return console.log(`Удален виджет с кодом ${code} и секретным ключом ${secretKey}.`)
            }
            if (!args.update) {
                return console.log(`Виджет с кодом ${code} уже существует, для его обновления укажите параметр --update`);
            }
            console.log(`Найден виджет с кодом ${code} и секретным ключом ${secretKey}.`);
        }

        WidgetInstaller.updateManifest(args.folder, code, secretKey);

        const archivePath = await WidgetInstaller.zipArchive(args.folder);
        console.log(`Создан архив ${archivePath}`);

        await wi.uploadWidget(archivePath, code, secretKey);
        console.log(`Виджет ${code} успешно загружен`);
    } catch (e) {
        console.error(e);
    }
})();

