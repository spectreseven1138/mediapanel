FILE=$1
GETGEXT=0

# Resolve GExt
if [ "$FILE" != "build/extension.js" ]
then
	if [ $GETGEXT ]
	then
	    sed -i 's/GExt/Self.imports.extension.GetGExt()/g'  "$FILE"
	else
	    sed -i 's/GExt/Self.imports.extension.ExtObject/g'  "$FILE"
	fi
fi

# Define "Self"
sed -i '1s;^;const Self = imports.misc.extensionUtils.getCurrentExtension()\;\n;' "$FILE"

# De-modularize
sed -i \
	-e 's#export function#function#g' \
	-e 's#export var#var#g' \
	-e 's#export const#var#g' \
	-e 's#Object.defineProperty(exports, "__esModule", { value: true });#var exports = {};#g' \
    "$FILE"
sed -i -E 's/export class (\w+)/var \1 = class \1/g' "$FILE"

# Rewrite module imports
sed -i -E "s/import \* as (\w+) from '(\w+)'/const \1 = Self.imports.\2/g" "$FILE"