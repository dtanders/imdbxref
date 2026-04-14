var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(options =>
{
    options.AddPolicy("ImdbPolicy", policy =>
        policy.WithOrigins("https://www.imdb.com", "https://imdb.com")
              .AllowAnyMethod()
              .AllowAnyHeader());
});

var app = builder.Build();
app.UseCors();

// ── In-memory store (single-user local tool) ──────────────────────────────────
var pages = new List<PageData>();
var pagesLock = new object();

// ── Static files ───────────────────────────────────────────────────────────────
app.UseStaticFiles();

// POST /api/collect  — called by the bookmarklet from inside the user's browser on imdb.com
app.MapPost("/api/collect", async (HttpContext ctx) =>
{
    var body = await ctx.Request.ReadFromJsonAsync<PageData>();
    if (body is null) return Results.BadRequest(new { error = "Invalid body" });

    int count;
    lock (pagesLock)
    {
        pages.Add(body);
        count = pages.Count;
    }

    return Results.Ok(new { slot = count, ready = count >= 2 });
}).RequireCors("ImdbPolicy");

// GET /api/status
app.MapGet("/api/status", () =>
{
    List<PageData> snapshot;
    lock (pagesLock) snapshot = pages.ToList();
    return Results.Ok(new { pages = snapshot, ready = snapshot.Count >= 2 });
});

// GET /api/compare
app.MapGet("/api/compare", () =>
{
    List<PageData> snapshot;
    lock (pagesLock) snapshot = pages.ToList();
    if (snapshot.Count < 2)
        return Results.BadRequest(new { error = "Need at least two pages collected" });

    static Dictionary<string, LinkData> Dedup(List<LinkData> links) =>
        links.GroupBy(l => l.Id)
             .ToDictionary(g => g.Key, g => g.OrderByDescending(l => l.Name.Length).First());

    var maps = snapshot.Select(p => Dedup(p.Links)).ToList();

    var commonIds = maps[0].Keys.AsEnumerable();
    for (int i = 1; i < maps.Count; i++)
        commonIds = commonIds.Intersect(maps[i].Keys);

    var results = commonIds
        .Select(id =>
        {
            var best = maps.Select(m => m[id]).OrderByDescending(l => l.Name.Length).First();
            var sections = maps.Select(m => m[id].Section).ToList();
            return new { best.Id, best.Type, best.Name, best.Url, Sections = sections };
        })
        .OrderBy(r => r.Name)
        .ToList();

    return Results.Ok(new { pages = snapshot.Select(p => p.Title).ToList(), results });
});

// DELETE /api/reset
app.MapDelete("/api/reset", () =>
{
    lock (pagesLock) pages.Clear();
    return Results.Ok();
});

// DELETE /api/collect/{index}  — remove a single collected page by 0-based index
app.MapDelete("/api/collect/{index:int}", (int index) =>
{
    lock (pagesLock)
    {
        if (index < 0 || index >= pages.Count) return Results.NotFound();
        pages.RemoveAt(index);
    }
    return Results.Ok();
});

app.MapFallbackToFile("index.html");
app.Run();

// ── Data model ─────────────────────────────────────────────────────────────────
record LinkData(string Id, string Type, string Name, string Url, string Section = "");
record PageData(string Title, List<LinkData> Links);
