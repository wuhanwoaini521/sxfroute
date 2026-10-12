declare const csvParser: {
  parse(
    input: string,
    options: {
      columns: true;
      skip_empty_lines: boolean;
      delimiter: string;
      trim: boolean;
    },
  ): Record<string, string>[];
};

export = csvParser;
