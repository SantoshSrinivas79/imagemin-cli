#!/usr/bin/env node
import fs from 'fs'; 
import {Buffer} from 'node:buffer';
import process from 'node:process';
import arrify from 'arrify';
import meow from 'meow';
import getStdin from 'get-stdin';
import imagemin from 'imagemin';
import ora from 'ora';
import plur from 'plur';
import stripIndent from 'strip-indent';
import pairs from 'lodash.pairs';

const cli = meow(`
	Usage
	  $ imagemin <path|glob> ... --out-dir=build [--plugin=<name> ...]
	  $ imagemin <file> > <output>
	  $ cat <file> | imagemin > <output>

	Options
	  --plugin, -p   Override the default plugins
	  --out-dir, -o  Output directory
	  --overwrite    Overwrite the original file with a minified version

	Examples
	  $ imagemin images/* --out-dir=build
	  $ imagemin foo.png > foo-optimized.png
	  $ cat foo.png | imagemin > foo-optimized.png
	  $ imagemin foo.png --plugin=pngquant > foo-optimized.png
	  $ imagemin foo.png --plugin.pngquant.quality=0.1 --plugin.pngquant.quality=0.2 > foo-optimized.png
	  # Non-Windows platforms may support the short CLI syntax for array arguments
	  $ imagemin foo.png --plugin.pngquant.quality={0.1,0.2} > foo-optimized.png
	  $ imagemin foo.png --plugin.webp.quality=95 --plugin.webp.preset=icon > foo-icon.webp
	  $ imagemin --overwrite foo.png
`, {
	importMeta: import.meta,
	flags: {
		plugin: {
			type: 'string',
			alias: 'p',
			isMultiple: true,
			default: [
				'gifsicle',
				'jpegtran',
				'optipng',
				'svgo',
			],
		},
		outDir: {
			type: 'string',
			alias: 'o',
		},
		boolean: [
			'overwrite'
		],
	},
});

const requirePlugins = plugins => Promise.all(plugins.map(async ([plugin, options]) => {
	try {
		const {default: _plugin} = await import(`imagemin-${plugin}`); // eslint-disable-line node/no-unsupported-features/es-syntax
		return _plugin(options);
	} catch {
		console.error(stripIndent(`
			Unknown plugin: ${plugin}

			Did you forget to install the plugin?
			You can install it with:

			  $ npm install -g imagemin-${plugin}
		`).trim());

		process.exit(1);
	}
}));

const normalizePluginOptions = plugin => {
	const pluginOptionsMap = {};

	for (const v of arrify(plugin)) {
		Object.assign(
			pluginOptionsMap,
			typeof v === 'object'
				? v
				: {[v]: {}},
		);
	}

	return pairs(pluginOptionsMap);
};

const run = async (input, {outDir, plugin} = {}) => {
	const pluginOptions = normalizePluginOptions(plugin);
	const plugins = await requirePlugins(pluginOptions);
	const spinner = ora('Minifying images');

	if (Buffer.isBuffer(input)) {
		process.stdout.write(await imagemin.buffer(input, {plugins}));
		return;
	}

	if (outDir) {
		spinner.start();
	}

	let files;
	try {
		files = await imagemin(input, {destination: outDir, plugins});
	} catch (error) {
		spinner.stop();
		throw error;
	}

	if (!outDir && files.length === 0) {
		return;
	}

	if (!outDir && files.length > 1) {
		console.error('Cannot write multiple files to stdout, specify `--out-dir`');
		process.exit(1);
	}

	if (!outDir) {
		process.stdout.write(files[0].data);
		return;
	}

	spinner.stop();

	console.log(`${files.length} ${plur('image', files.length)} minified`);
};

const runOverwrite = async (input, {outDir, plugin} = {}) => {
	const pluginOptions = normalizePluginOptions(plugin);
	const plugins = await requirePlugins(pluginOptions);
	const spinner = ora('Minifying images');

	spinner.start();

	try {
		input.forEach(file => {
			const origFile = fs.readFileSync(file);
			imagemin.buffer(origFile, {plugins})
				.then(buff => {
					console.log(`${file} -> ${buff.length} bytes`);
					fs.writeFile(file, buff, err => {
						if (err) {
							throw err;
						}
					});
				})
				.catch(err => {
					throw err;
				});
		});
	} catch (error) {
		spinner.stop();
		throw error;
	}

	spinner.stop();
};

if ((cli.input.length === 0 && process.stdin.isTTY) || (cli.input.length === 0 && cli.flags.overwrite)) {
	console.error('Specify at least one file path');
	process.exit(1);
}

(async () => {
	if(cli.flags.overwrite){
		await runOverwrite(
			cli.flags.overwrite
				? cli.input
				: await getStdin.buffer(),
			cli.flags);
	} else {
		await run(
			cli.input.length > 0
				? cli.input
				: await getStdin.buffer(),
			cli.flags);
	}
})();
