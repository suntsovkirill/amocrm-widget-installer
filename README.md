# amoCRM widget installer
## Install
```
npm install -g amocrm-widget-installer
```
## CLI
Creates a widget if it does not exist and upload widget:
```
amoinst -d SUBDOMAIN -l AMO_LOGIN -a AMO_HASH -n WIDGET_CODE -f WIDGET_FOLDER --update
```
Delete widget:
```
amoinst -d SUBDOMAIN -l AMO_LOGIN -a AMO_HASH -n WIDGET_CODE --delete
```