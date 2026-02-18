const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { minify } = require('terser');
const { minify: minifyHTML } = require('html-minifier-terser');

// Configuration - adjust these for your project
const config = {
  // Source directory
  inputDir: '.',

  // Output directory
  outputDir: './dist',

  // Files/folders to exclude from processing
  exclude: [
    'node_modules',
    'dist',
    '.git',
    '.gitignore',
    'package.json',
    'package-lock.json',
    'build.js',
    'README.md',
    '.DS_Store',
    'old-index.html'
  ],

  // Whether to obfuscate JS filenames
  obfuscateFilenames: false,

  // Whether to minify files
  minify: true,

  // Domain protection (set to null to disable, or array of allowed domains)
  // Example: ['example.com', 'myapp.pages.dev']
  allowedDomains: null
};

// Generate obfuscated filename
const generateObfuscatedName = (originalName) => {
  const hash = crypto.createHash('md5').update(originalName + Date.now()).digest('hex').substring(0, 8);
  const ext = path.extname(originalName);
  return `${hash}${ext}`;
};

// Track filename mappings for HTML updates
const fileMapping = new Map();

// Check if path should be excluded
const shouldExclude = (filePath) => {
  const relativePath = path.relative(config.inputDir, filePath);
  return config.exclude.some(excluded =>
    relativePath === excluded ||
    relativePath.startsWith(excluded + path.sep) ||
    path.basename(filePath) === excluded
  );
};

// Create output directory
if (fs.existsSync(config.outputDir)) {
  fs.rmSync(config.outputDir, { recursive: true });
}
fs.mkdirSync(config.outputDir, { recursive: true });

// Generate anti-tampering code if domains are specified
const getAntiTamperCode = () => {
  if (!config.allowedDomains || config.allowedDomains.length === 0) {
    return '';
  }

  const domainsArray = JSON.stringify(config.allowedDomains);
  return `(function(){
    var a=${domainsArray};
    var h=location.hostname;
    if(location.protocol!=='file:'&&h!==''&&h!=='localhost'&&!h.endsWith('.pages.dev')&&!a.some(function(d){return h===d||h.endsWith('.'+d);})){
      document.body.innerHTML='<div style="text-align:center;margin-top:200px;font-size:20px;">Unauthorized Access</div>';
      throw new Error('Domain verification failed');
    }
  })();`;
};

// Process a single file
const processFile = async (filePath, relativePath) => {
  const outputPath = path.join(config.outputDir, relativePath);
  const outputDir = path.dirname(outputPath);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  // Process JavaScript files
  if (ext === '.js') {
    const code = fs.readFileSync(filePath, 'utf8');

    let outputCode = code;
    let outputFileName = fileName;

    if (config.minify) {
      try {
        const result = await minify(code, {
          compress: {
            dead_code: true,
            drop_console: true,
            drop_debugger: true,
          },
          mangle: {
            toplevel: true,
          },
          format: {
            comments: false,
          },
        });
        outputCode = result.code;
      } catch (err) {
        console.warn(`⚠ Could not minify ${fileName}, copying as-is`);
      }
    }

    // Add anti-tampering if configured
    const antiTamper = getAntiTamperCode();
    if (antiTamper) {
      outputCode = antiTamper + outputCode;
    }

    // Obfuscate filename if configured
    if (config.obfuscateFilenames) {
      outputFileName = generateObfuscatedName(fileName);
      fileMapping.set(fileName, outputFileName);
    }

    const finalOutputPath = path.join(outputDir, outputFileName);
    fs.writeFileSync(finalOutputPath, outputCode);
    console.log(`✓ Processed ${relativePath}${config.obfuscateFilenames ? ` → ${outputFileName}` : ''}`);
  }
  // Process HTML files
  else if (ext === '.html' || ext === '.htm') {
    let html = fs.readFileSync(filePath, 'utf8');

    // Update script src references with obfuscated names
    if (config.obfuscateFilenames) {
      fileMapping.forEach((obfuscatedName, originalName) => {
        const scriptRegex = new RegExp(`src=["']([^"']*${originalName})["']`, 'g');
        html = html.replace(scriptRegex, `src="${obfuscatedName}"`);
      });
    }

    if (config.minify) {
      try {
        html = await minifyHTML(html, {
          collapseWhitespace: true,
          removeComments: true,
          minifyJS: true,
          minifyCSS: true,
        });
      } catch (err) {
        console.warn(`⚠ Could not minify ${fileName}, copying as-is`);
      }
    }

    fs.writeFileSync(outputPath, html);
    console.log(`✓ Processed ${relativePath}`);
  }
  // Process CSS files
  else if (ext === '.css' && config.minify) {
    let css = fs.readFileSync(filePath, 'utf8');
    // Basic CSS minification (remove comments and whitespace)
    css = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([{}:;,])\s*/g, '$1')
      .trim();
    fs.writeFileSync(outputPath, css);
    console.log(`✓ Processed ${relativePath}`);
  }
  // Copy other files as-is
  else {
    fs.copyFileSync(filePath, outputPath);
    console.log(`✓ Copied ${relativePath}`);
  }
};

// Recursively process directory
const processDirectory = async (dir, baseDir = dir) => {
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);

    if (shouldExclude(fullPath)) {
      continue;
    }

    const stat = fs.statSync(fullPath);
    const relativePath = path.relative(baseDir, fullPath);

    if (stat.isDirectory()) {
      await processDirectory(fullPath, baseDir);
    } else {
      await processFile(fullPath, relativePath);
    }
  }
};

// Copy data directory (JSON files only, no PDFs)
const copyDataDirectory = () => {
  const dataLlmSrc = './data/llm';
  const dataLlmDest = path.join(config.outputDir, 'data/llm');

  if (!fs.existsSync(dataLlmSrc)) {
    console.log('⚠ No data/llm directory found, skipping...');
    return;
  }

  console.log('\n📁 Copying data/llm directory...');

  const copyDir = (src, dest) => {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const items = fs.readdirSync(src);
    for (const item of items) {
      const srcPath = path.join(src, item);
      const destPath = path.join(dest, item);
      const stat = fs.statSync(srcPath);

      if (stat.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        // Only copy JSON files
        if (path.extname(item).toLowerCase() === '.json') {
          fs.copyFileSync(srcPath, destPath);
          console.log(`✓ Copied ${path.relative('.', srcPath)}`);
        }
      }
    }
  };

  copyDir(dataLlmSrc, dataLlmDest);
};

// Main build process
const build = async () => {
  console.log('🔨 Building project...\n');
  console.log(`   Source: ${path.resolve(config.inputDir)}`);
  console.log(`   Output: ${path.resolve(config.outputDir)}`);
  console.log(`   Minify: ${config.minify}`);
  console.log(`   Obfuscate: ${config.obfuscateFilenames}`);
  console.log(`   Domain protection: ${config.allowedDomains ? 'enabled' : 'disabled'}\n`);

  await processDirectory(config.inputDir);

  // Copy data/llm directory (excludes data/pdf and scripts by design)
  copyDataDirectory();

  console.log('\n✅ Build complete!');
  console.log(`   Output directory: ${path.resolve(config.outputDir)}`);
};

build().catch(err => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
