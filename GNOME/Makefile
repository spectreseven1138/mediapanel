UUID = $(shell grep -E '^[ ]*"uuid":' ./metadata.json | sed 's@^[ ]*"uuid":[ ]*"\(.\+\)",[ ]*@\1@')

ifeq ($(strip $(DESTDIR)),)
INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
else
INSTALLBASE = $(DESTDIR)/usr/share/gnome-shell/extensions
endif
INSTALLNAME = $(UUID)

.PHONY: all clean install zip-file

sources = src/**/*.ts

all: depcheck build

clean:
	rm -rf build

transpile: @types $(sources)
	rm -rf build
	tsc --skipLibCheck

@types: $(@types/)
	ts-for-gir generate --configName=ts-for-gir.config.js

build: convert metadata.json stylesheet.css
	cp metadata.json build/
	cp stylesheet.css build/

convert: transpile
	for file in `find build -name \*.js`; do \
		bash tools/rewrite_imports.sh "$${file}"; \
	done; \
	python3 tools/rewrite_imports.py;

depcheck:
	@if ! command -v tsc >/dev/null; then \
		echo \
		echo 'You must install TypeScript >= 3.8 to transpile'; \
		exit 1; \
	fi

enable:
	gnome-extensions enable "$(UUID)"

disable:
	gnome-extensions disable "$(UUID)"

install:
	rm -rf $(INSTALLBASE)/$(INSTALLNAME)
	mkdir -p $(INSTALLBASE)/$(INSTALLNAME)
	cp -r build/* $(INSTALLBASE)/$(INSTALLNAME)/

uninstall:
	rm -rf $(INSTALLBASE)/$(INSTALLNAME)

restart-shell:
	killall -3 gnome-shell

zip-file: all
	cd build && zip -qr "../$(UUID)$(VSTRING).zip" .
