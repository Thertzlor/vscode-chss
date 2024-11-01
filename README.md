<p  align="center">
		<img width="30%" src="https://raw.githubusercontent.com/Thertzlor/vscode-chss/refs/heads/main/img/chss_icon_512.png" />
</p>

# CHSS: Code Highlighting Stylesheets
![Version](https://img.shields.io/visual-studio-marketplace/v/thertzlor.vscode-chss) ![License](https://img.shields.io/github/license/thertzlor/vscode-chss) [![CodeFactor](https://www.codefactor.io/repository/github/thertzlor/vscode-chss/badge/main)](https://www.codefactor.io/repository/github/thertzlor/vscode-chss/overview/main)

Is the syntax highlighting with regular VSCode themes not detailed enough?  
Did you ever wish you could use CSS to style your code yourself and assign colors and decorations to variables or functions with specific names?  
What if you could do this on a per-project basis in real-time?

Now you can. The *CHSS* extension hijacks VSCode's semantic highlighting to give you complete control over any semantic elements in your code, allowing you to style them with a dialect of css.

<p  align="center"><img width="80%" src="https://raw.githubusercontent.com/Thertzlor/vscode-chss/refs/heads/main/img/chss_demo.gif" /></p>

The future is now. Imagine styling the css file that styles your website with css. And since the .chss file is also css, imagine the .chss file that styles the css file that styles your website being styled with .chss rules *from itself*.  
Some may say technology has gone too far. Install this extension to find out if they are right.

## Installation
Install from VSCode or via the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=thertzlor.vscode-chss).  
After installing the extension, simply create a file with the `.chss` extension in the root directory of any project and you're ready to go.  
The location of the file and some other behavior can be changed in the [extension's settings](#extension-settings).
## Compatibility
The decorations defined by this extension will be put on top of any colors and formatting provided by regular vscode themes. Personally, I recommend running this extension "on top" of a minimal, muted color theme for extra contrast with manually defined styles.  

As mentioned, CHSS works on semantic tokens provided by the current language server, so make sure your project is in a language that has a semantic highlighting capable syntax highlighting extension installed. You can use the `Developer: Inspect Editor Tokens and Scopes` command to check which tokens and modifier are used.

Since this extension needs to reevaluate all semantic tokens, re-read the file and then insert dozens or potentially hundreds of text decorations, using it with very huge files might not be the most performant.
##  The CHSS Syntax
CHSS is basically vague bastardization of (S)CSS (.chss files also use VSCode's highlighting for scss).  
This works out because style rules are internally converterted into [DecorationRenderOptions](https://code.visualstudio.com/api/references/vscode-api#DecorationRenderOptions) and most of the properties are css rules already.  

```scss
// CHSS supports single line comments.

// matches any semantic token called "important_var".
important_var {
  // all the usual ways of specifying colors in CSS are supported.
  color: crimson;
  border-style: dotted;
}

// matches any function called "examples".
.example{color: #daa520;}

// matches all classes called "MyClass".
MyClass[class]{
  color: deepskyblue;
  text-decoration: overline;
}

// matches any token with the "declaration" modifier.
:declaration{font-style: italic;}

// matches all tokens of the "method" type. The exact token types available depend on the language server.
[method]{background-color: midnightblue;}

```

### Available CHSS Properties

>**Note:** All properties can be specified both in CSS style (`background-color`) and JS style (`backgroundColor`)

* **color**
* **opacity**
* **backgroundColor**
* **fontStyle**
* **fontWeight**
* **textDecoration**
* **letterSpacing**
* **cursor**
* **border**
* **borderColor**
* **borderRadius**
* **borderSpacing**
* **borderStyle**
* **borderWidth**
* **outline**
* **outlineColor**
* **outlineStyle**
* **outlineWidth**
* **gutterIconPath**
* **gutterIconSize**
* **isWholeLine**
* **overviewRulerLane**
* **overviewRulerColor**

A detailed description of the values that these properties accept and what exactly they do can be found in the [VSCode API documentation](https://code.visualstudio.com/api/references/vscode-api#DecorationRenderOptions).  
Every property that accepts a color value can also accept a [color transformation](#color-transformations-using-tinycolor).


### Basic Selectors

| Selector          | Example              | Description                                                       | Notes                                                                      |
| ----------------- | -------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **name**          | `foo`                | select any type of token named 'foo'                              |
| **#var**          | `#foo`               | Select any variable named 'foo'                                   |                                                                            |
| **.function**     | `.getFoo`            | Select any function with named 'getFoo'                           |                                                                            |
| **:modifier**     | `:readonly`          | select only tokens with the *readonly* modifier                   | Multiple `:` modifers can be chained.                                      |
| **:mod1/mod2**    | `:declaration/async` | select only tokens with the *declaration* **or** *async* modifier | More than two slashes are supported, whitespace around the slashes is not. |
| **[tokenType]**   | `[parameter]`        | select all semantic tokens of type "parameter"                    | Semantic token names depend on the language server.                        |
| **[type1/type2]** | `[class/property]`   | select all semantic tokens of type "class" **or** "property"      | More than two slashes are supported as well as whitespace around them.     |
### Combined selectors
Type and name selectors can be combined such as `Example[class]` and modifier selectors can be combined with any other type, for example `foo:readonly`, `.getFoo:async` and a combination of all three types is possible as well (`Example[class]:declaration`) as long as the order of *name -> type -> modifier* is preserved.

>**Note:** There is as of yet no concept of relations between tokens, so features like sibling and descendant selectors in CSS, for use cases like "select variables in a class named x" or "select a variable x defined right after class y" are **not** possible. [For this we would need to parse an actual AST, too much work for now]
### Advanced Selectors

| Selector                  | Example                                         | Description                                                                                                      | Notes                                                                                                   |
| ------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **<wildcard*match>**      | `<foo*bar>`                                     | select any token starting with 'foo' and ending with 'bar'                                                       | Multiple wildcards are allowed                                                                          |
| **<*="include">**         | `<*="foo">`                                     | select any token which includes 'foo'                                                                            | The Double quotes are technically optional but omitting them breaks the highlighting inside the rule.   |
| **<^="start">**           | `<^="foo">`                                     | select any token starting with 'foo'                                                                             |                                                                                                         |
| **<$="end">**             | `<$="bar">`                                     | select any token ending with 'bar'                                                                               |                                                                                                         |
| **<"/regex/">**           | `<"/foo(bar)?/">`                               | select any token matching the regex /foo(bar)?/                                                                  | `<"/regex/i">` is supported for case insensitive matching                                               |
| **<*="match"=type>**      | `<^="foo"=variable>, <$=bar=function:readonly>` | select variables starting with 'foo' and functions ending with 'bar'.                                            | A regex match also needs to be prepended with `=` as in `<="/regex/"=type>` to work with type selectors |
| **selector::pseudoclass** | `foo::before, .getFoo::after`                   | style the 'before' pseudoclass of any token named foo and the 'after' pseudoclass of any function named 'getFoo' | Just as in regular CSS, pseudoclasses need `text-content`/`textContent` to be set.                      |

### Cascading
CHSS attempts to follow the same general rules of weight that CSS does, with more specific rules having higher weight: Direct name selectors trump matches and types which trump modifiers.
For rules with the same specificity, the last one wins.

### Scoping
Within the .chss file of your project you can apply rules to one or more specific files of your workspace by wrapping rules into a `scope()` function that takes a glob pattern as its argument.

```scss

//The following section applies only to .js files in the workspace.
scope("**\*.js"){

  #window{
    color:red
  }

}

// Rule with the same selector for all other files
#window{
  color:blue
}

```

### Color Transformations (using Tinycolor)
Besides directly defining colors in a rule you can also apply a color transformation to an existing color value set by a less specific rule (this functionality is "inspired" by my previous extension [Semantic Rainbow]()).  
If you have worked with the CSS `filter` property before this works basically the same, except arguably more versatile because here you can control different color properties like background, text, border-color, etc separately.

The following transformations are supported:
* **lighten**
* **brighten**
* **darken**
* **desaturate**
* **saturate**
* **spin**
* **greyscale**
* **random**

With the exception of `greyscale` and `random` all transformations accept a single numeric argument. A detailed description of the functionality can be found in the [TinyColor Documentation](https://github.com/bgrins/TinyColor?tab=readme-ov-file#color-modification).

```scss

// Set the text color of all functions to blue.
[function]{
  color: blue
}

// Readonly functions desaturate the blue by 50%.
[function]:readonly{
  color: desaturate(50)
}

```

> **Note:** You can only transform colors that have been explicitly set by CHSS, we do *not* have access to the underlying standard token colors of the theme.

## Extension Settings
This extension has the following settings:

*  `chss.stylesheetLocation`:Path or glob pattern for your code stylesheet.
*  `chss.realtimeCHSS`:Apply style updates in real-time while editing the .chss file. Disable to only apply styles to the project once the .chss file is saved.
*  `chss.caseInsensitiveMatch`:Enable to make normal selectors such as `name` and `[*=name]` also match tokens named `Name` and `myName` respectively. Regex matches are however still controlled with the /i flag.

## Planned Features & Roadmap

* Brainstorming some very silly ideas about converting an AST to a DOM and running actual CSS selectors on it for proper positional selectors. This is going to be very inefficient. 
* `:not()` pseudo class would be neat.
* `::light` and `::dark` pseudo classes to style for light and dark themes.
* There used to be a fairly popular extension called [Apc Customize UI++](https://github.com/drcika/apc-extension) for injecting custom CSS which is unfortunately not working in recent VSCode versions. If it gets fixed, or another real-time CSS injector really takes off, it would be maybe possible to unlock the full power of CSS for CHSS.
* *Maybe* adding support for selecting textmate scopes, (but VSCode also might pivot to Tree-Sitter as the language server fallback, so who knows). This is also going to be inefficient if it ever happens.

## Credits
* [Kevin Ghadyani](https://github.com/Sawtaytoes) and [Valerij Primachenko](https://github.com/vprimachenko) for their semantic coloring implementations in [ColorMate](https://github.com/Sawtaytoes/vscode-colormate) and [Colorcoder](https://github.com/vprimachenko/Sublime-Colorcoder) and the general concept of name based highlighting that I am taking way too far with this.
* [TinyColor](https://github.com/bgrins/TinyColor) for their neat color transformations.
* CHSS logo adapted from the official CSS3 logo (even though there's nothing official about this extension and the W3C would probably hate it).