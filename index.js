
var extend    = hexo.extend,
    util      = hexo.util,
    file      = util.file2,
    config    = hexo.config,
    src_path  = hexo.source_dir;

var xml2js    = require('xml2js'),
    parser    = new xml2js.Parser(),
    fs        = require('graceful-fs'),
    requesst  = require('request'),
    async     = require('async'),
    _         = require('underscore'),
    tomd      = require('to-markdown').toMarkdown,
    EOL       = require('os').EOL,
    http      = require('http-get'),
    unzip     = require('unzip');

/**
 * Some common functions
 */
function strip_yaml (strtext) {
  strtext = strtext.replace('\"', '\'');
  strtext = strtext.replace('---', '--');
  strtext = strtext.replace('```', '');
  strtext = strtext.replace('~~~', '~');

  return strtext;
}

extend.migrator.register('wretch', function (args) {

var MSG_USEAGE = '\nUsage: hexo migrate wretch <source.zip> [with_foto] [with_comment]\nMore info: http://zespia.tw/hexo/docs/migrate.html\n';

  var source = args._.shift();
  if (!source) return console.log(MSG_USEAGE);

  var wretch = {
    conf : {
      with_foto : false,
      with_comment : false,
      folder_name : '',
      foto_path : ''
    },
    articles : {},
    category_list : {
      0 : 'uncategory'
    },
    foto_urls : {},
    comment_list : {}
  };

  for (var i = 0; i < args._.length; i++) {
    if (args._[i] == 'with_comment')
      wretch.conf.with_comment = true;
    else if (args._[i] == 'with_foto')
      wretch.conf.with_foto = true;
  }

  async.waterfall([

    function (next) {
      fs.exists(source, function (exists) {
        if (!exists)
          return console.log('ERR: File %s does not exist.\n' + MSG_USEAGE, source);

        console.log('Import wretch post from %s...', source);

        var r = fs.createReadStream(source).pipe(unzip.Extract({ path: 'tmp' }));
        r.on('close', function() {
          file.list('tmp', function (err, data) {

            wretch.conf.folder_name = data[0].split(/^([a-zA-Z0-9_\-]+)\/.*/)[1];
            for (var i = 0; i < data.length; i++) {
              if (data[i].match(/\.xml$/)) {
                file.readFile('tmp/' + data[i], next);
                return 1;
              }
            }

            return 'ERR: Can not find wretch XML file in your zip. \nPlease make sure your zip in correct format.\n' + MSG_USEAGE;
          });
        });
      });
    },

    function (data, next) {
      console.log('Parsing XML...');
      parser.parseString(data, next);
    },

    function (data, next) {
      console.log('Analyzing...');
      wretch.articles = data.blog_backup.blog_articles[0].article;

      // Generate category list
      console.log('-> Parsing atricle category...');
      for (var i = 0; i < data.blog_backup.blog_articles_categories[0].category.length; i++) {
        wretch.category_list[data.blog_backup.blog_articles_categories[0].category[i].id[0]] = data.blog_backup.blog_articles_categories[0].category[i].name[0];
      }

      // Parsing comments...
      if (wretch.conf.with_comment) {
        console.log('-> Parsing comments...');
        for (var i = 0; i < data.blog_backup.blog_articles_comments[0].article_comment.length; i++) {
          var nexttxt = '';
          nexttxt += '<div class="comment">' + EOL;
          nexttxt += '  <span class="author">' + data.blog_backup.blog_articles_comments[0].article_comment[i].name[0] + '</span><span class="date">' + data.blog_backup.blog_articles_comments[0].article_comment[i].date[0] + '</span><br />' + EOL;
          nexttxt += '  <span class="txt">' + tomd(data.blog_backup.blog_articles_comments[0].article_comment[i].text[0]) + '</span>' + EOL;
          nexttxt += '</div>' + EOL;

          if (typeof wretch.comment_list[data.blog_backup.blog_articles_comments[0].article_comment[i].article_id[0]] === 'undefined')
            wretch.comment_list[data.blog_backup.blog_articles_comments[0].article_comment[i].article_id[0]] = nexttxt;
          else
            wretch.comment_list[data.blog_backup.blog_articles_comments[0].article_comment[i].article_id[0]] += nexttxt;
        }
      }

      // Generating fotos URL list...
      if (wretch.conf.with_foto) {
        console.log('-> Generating fotos URL list...');
        file.list('tmp/' + wretch.conf.folder_name + '/album', function (err, data) {
          wretch.conf.foto_path = 'foto/';
          async.forEach(data, function (item, next) {
            if (item.match('.txt')) {
              var arrurls = fs.readFileSync('tmp/' + wretch.conf.folder_name + '/album/' + item, 'utf8').split('\n');
              var bid = arrurls[0].split('/')[4];
              var f = {};

              for (var i = 0; i < arrurls.length - 1; i++)
                f[arrurls[i].split('/')[5].split('?')[0]] = arrurls[i];
              wretch.foto_urls[bid] = f;
            }
            next();
          }, function (err) {
            if (err) throw err;

            async.forEach(wretch.articles, function (item, next) {
              file.mkdirs(wretch.conf.foto_path + item.id[0] + '/', next);
            }, function (err) {
              next(null, wretch.articles);
            });
          });
        });
      } else {
        next(null, wretch.articles);
      }
    },

    function (data, next) {
      console.log("Generating articles...");

      var length = 0;

      async.forEach(data, function (item, next) {
        var post_id       = item.id[0],
            post_title    = strip_yaml(item.title[0]),
            post_date     = item.date[0],
            post_updated  = item.PostTime[0],
            post_category = strip_yaml(wretch.category_list[item.category_id[0]]);

        //
        if (wretch.conf.with_foto) {
          var arr = item.text[0].split(/(\{###_\w*\/[0-9]+\/[0-9]+.jpg_###\})/);
          for (var i = 0; i < arr.length; i++) {
            if (arr[i].match(/\{###_\w*\/[0-9]+\/[0-9]+.jpg_###\}/)) {
              var fbid = arr[i].split(/\{###_\w*\/([0-9]+)\/([0-9]+.jpg)_###\}/)[1],
                  ffid = arr[i].split(/\{###_\w*\/([0-9]+)\/([0-9]+.jpg)_###\}/)[2];

              if (typeof wretch.foto_urls[fbid] == 'undefined')
                break;
              if (typeof wretch.foto_urls[fbid][ffid] == 'undefined')
                break;

              http.get(wretch.foto_urls[fbid][ffid], wretch.conf.foto_path + post_id + '/' + ffid, function (err, result) {
                if (err) {
                  console.error(err);
                } else {
                  console.log('\tFile downloaded at: ' + result.file);
                }
              });

              item.text[0] = item.text[0].replace(arr[i], '![' + ffid + '](' + config.url + config.root + 'foto/' + post_id + '/' + ffid + ')');
            }
          }
        }

        post_content = tomd(strip_yaml(item.text[0]));

        if (wretch.conf.with_comment) {
          if (typeof wretch.comment_list[post_id] != 'undefined')
            post_content += EOL + EOL + '<!-- more -->' + EOL + '<div class="wretch_comments">' + EOL + wretch.comment_list[post_id] + EOL + '</div>' + EOL;
        }

        var content = [
          'title: "' + post_title.replace(/"/g, '\\"') + '"',
          'id: ' + post_id,
          'date: ' + post_date,
          'updated: ' + post_updated,
          'categories: ' + post_category,
          '---'
        ];

        length++;
        file.writeFile('source/_posts/wretch/' + post_id + '.md', content.join('\n') + '\n\n' + post_content, next);

      }, function (err) {
        next(null, length);
      });
    }
  ], function (err, length) {
    if (err) throw err;

    file.rmdir('tmp');
    console.log('-> %d posts migrated.', length);
  });
});

