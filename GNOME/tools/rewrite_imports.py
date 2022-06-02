#!/usr/bin/python3

# import * as MediaPanel from "mediapanel";
# const Impl = Self.imports.extension_impl;

import os
from os.path import join

def convert(file: str):
    f = open(file, "r")
    in_data = f.readlines()
    f.close()

    A = "import * as "
    B = "from"

    out_data = []
    for line in in_data:

        if line.startswith(A):
            split = line.removeprefix(A).split(" ")
            print(split)
            if len(split) == 3 and split[1] == B and split[2].startswith("\"") and split[2].endswith("\";\n"):
                source = split[2].removeprefix('"').removesuffix('";\n')
                line = f"const {split[0]} = Self.imports.{source};\n"


        out_data.append(line)
    
    f = open(file, "w")
    f.writelines(out_data)
    f.close()

if __name__ == "__main__":
    for file in os.listdir("./build"):
        file = join("./build", file)
        if os.path.isfile(file) and file.endswith(".js"):
            convert(file)